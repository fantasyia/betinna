import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '@database/prisma.service';
import { SendGridService } from '@integrations/sendgrid/sendgrid.service';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { DeadLetterService } from '@modules/dead-letter/dead-letter.service';
import { IdempotencyService } from '@shared/utils/idempotency.service';
import { CampanhaIaService } from './campanha-ia.service';
import { CAMPANHA_ENVIO_QUEUE, type CampanhaEnvioJobData } from './campanha-envio.types';
import { CampanhasService } from './campanhas.service';

// ─── Interpolação simples de variáveis {{campo.subcampo}} ─────────────────────

function interpolar(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path: string) => {
    const keys = path.split('.');
    let val: unknown = vars;
    for (const k of keys) {
      if (val != null && typeof val === 'object') val = (val as Record<string, unknown>)[k];
      else return '';
    }
    return val != null ? String(val) : '';
  });
}

// ─── Processor ───────────────────────────────────────────────────────────────

@Processor(CAMPANHA_ENVIO_QUEUE, { concurrency: 3 })
export class CampanhaEnvioProcessor extends WorkerHost {
  private readonly logger = new Logger(CampanhaEnvioProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campanhasService: CampanhasService,
    private readonly whatsapp: WhatsAppService,
    private readonly sendgrid: SendGridService,
    private readonly campanhaIa: CampanhaIaService,
    private readonly idempotency: IdempotencyService,
    private readonly deadLetter: DeadLetterService,
  ) {
    super();
  }

  /**
   * Sprint 3 FIX 3: ouve `failed` do worker e move pro dead-letter quando
   * todos os retries esgotaram.
   *
   * `job.attemptsMade` é incrementado ANTES desse handler ser chamado, então
   * `>= attempts` significa que esta foi a última tentativa.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<CampanhaEnvioJobData>, err: Error): Promise<void> {
    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      // Ainda há retries pendentes — não vai pro dead-letter
      return;
    }
    // Enriquece com empresaId via campanha (não está no payload)
    let empresaId: string | undefined;
    try {
      const camp = await this.prisma.campanha.findUnique({
        where: { id: job.data.campanhaId },
        select: { empresaId: true },
      });
      empresaId = camp?.empresaId;
    } catch {
      /* empresaId continua undefined — dead-letter ainda registra */
    }
    if (empresaId) {
      // Mutate data antes de passar — DeadLetterService lê de data.empresaId
      (job.data as unknown as Record<string, unknown>).empresaId = empresaId;
    }
    await this.deadLetter.record({
      originalQueue: CAMPANHA_ENVIO_QUEUE,
      originalJob: job,
      error: err,
    });
  }

  async process(job: Job<CampanhaEnvioJobData>): Promise<void> {
    const { campanhaId, destinatarioId } = job.data;

    const dest = await this.prisma.campanhaDestinatario.findUnique({
      where: { id: destinatarioId },
      include: {
        campanha: {
          include: {
            empresa: { select: { id: true, nome: true } },
          },
        },
        cliente: {
          select: {
            id: true,
            nome: true,
            email: true,
            segmento: true,
            cidade: true,
            uf: true,
          },
        },
      },
    });

    if (!dest) {
      this.logger.warn(`Destinatário ${destinatarioId} não encontrado — job ignorado`);
      return;
    }

    // Campanha pausada ou cancelada → não envia
    if (['PAUSADA', 'CANCELADA'].includes(dest.campanha.status)) {
      this.logger.log(
        `Campanha ${campanhaId} está ${dest.campanha.status} — destinatário ${destinatarioId} ignorado`,
      );
      return;
    }

    const vars: Record<string, unknown> = {
      cliente: {
        nome: dest.cliente.nome,
        email: dest.cliente.email ?? '',
        segmento: dest.cliente.segmento ?? '',
        cidade: dest.cliente.cidade ?? '',
      },
      empresa: { nome: dest.campanha.empresa.nome },
    };

    // Resolve mensagem: IA personalizada (se habilitado) ou interpolação simples
    let mensagemWaFinal = dest.campanha.mensagemWa
      ? interpolar(dest.campanha.mensagemWa, vars)
      : null;
    let mensagemEmailFinal = dest.campanha.mensagemEmail
      ? interpolar(dest.campanha.mensagemEmail, vars)
      : null;

    if (dest.campanha.usarIaPersonalizacao) {
      const personalizado = await this.campanhaIa.personalizarMensagemCliente({
        criadoPorId: dest.campanha.criadoPorId,
        templateWa: mensagemWaFinal,
        templateEmail: mensagemEmailFinal,
        cliente: {
          nome: dest.cliente.nome,
          segmento: dest.cliente.segmento,
          cidade: dest.cliente.cidade,
          uf: dest.cliente.uf,
        },
        objetivo: dest.campanha.objetivo,
        empresaNome: dest.campanha.empresa.nome,
      });
      mensagemWaFinal = personalizado.mensagemWa;
      mensagemEmailFinal = personalizado.mensagemEmail;
    }

    try {
      const canal = dest.campanha.canal;

      // AUDITORIA P0-1: idempotency claim ANTES de cada side-effect externo.
      // Se retry após sucesso: claim já existe → skip envio.
      if (canal === 'WHATSAPP' || canal === 'WHATSAPP_EMAIL') {
        if (dest.telefone && mensagemWaFinal) {
          const idemKey = `idempotent:campanha:${campanhaId}:${destinatarioId}:wa`;
          if (await this.idempotency.claim(idemKey, 86_400)) {
            try {
              await this.whatsapp.enviarTexto(
                dest.campanha.empresaId,
                dest.telefone,
                mensagemWaFinal,
              );
              this.logger.debug(`WA enviado → ${dest.telefone} (campanha ${campanhaId})`);
            } catch (sendErr) {
              // Falha no provider — libera claim pra próxima tentativa retry
              await this.idempotency.release(idemKey);
              throw sendErr;
            }
          } else {
            this.logger.debug(
              `WA já enviado a este destinatário (claim existe) — skip [${campanhaId}/${destinatarioId}]`,
            );
          }
        }
      }

      if (canal === 'EMAIL' || canal === 'WHATSAPP_EMAIL') {
        if (dest.email && mensagemEmailFinal) {
          const assunto = dest.campanha.assunto
            ? interpolar(dest.campanha.assunto, vars)
            : dest.campanha.nome;
          const idemKey = `idempotent:campanha:${campanhaId}:${destinatarioId}:email`;
          if (await this.idempotency.claim(idemKey, 86_400)) {
            try {
              await this.sendgrid.enviar(dest.campanha.criadoPorId, {
                para: { email: dest.email, name: dest.cliente.nome },
                assunto,
                html: mensagemEmailFinal,
              });
              this.logger.debug(`Email enviado → ${dest.email} (campanha ${campanhaId})`);
            } catch (sendErr) {
              await this.idempotency.release(idemKey);
              throw sendErr;
            }
          } else {
            this.logger.debug(
              `Email já enviado a este destinatário (claim existe) — skip [${campanhaId}/${destinatarioId}]`,
            );
          }
        }
      }

      await this.prisma.campanhaDestinatario.update({
        where: { id: destinatarioId },
        data: { status: 'ENVIADO', enviadoEm: new Date() },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar para destinatário ${destinatarioId}: ${msg}`);
      await this.prisma.campanhaDestinatario.update({
        where: { id: destinatarioId },
        data: { status: 'ERRO', erro: msg.slice(0, 500) },
      });
    }

    await this.campanhasService.tentarFinalizarCampanha(campanhaId);
  }
}
