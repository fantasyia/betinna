import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '@database/prisma.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import { WhatsAppService } from '@integrations/whatsapp/whatsapp.service';
import { DeadLetterService } from '@modules/dead-letter/dead-letter.service';
import { IdempotencyService } from '@shared/utils/idempotency.service';
import { interpolate } from '@shared/utils/interpolate';
import { WhatsappPacingService } from '@shared/whatsapp-pacing/whatsapp-pacing.service';
import { CampanhaIaService } from './campanha-ia.service';
import { CAMPANHA_ENVIO_QUEUE, type CampanhaEnvioJobData } from './campanha-envio.types';
import { CampanhasService } from './campanhas.service';

// ─── Interpolação de variáveis {{campo.subcampo}} ─────────────────────────────
// Util único de @shared. `ausenteVazio: true` — campanha vai pro cliente final,
// então variável faltando vira '' (NUNCA `{{cliente.nome}}` literal no WhatsApp).
function interpolar(template: string, vars: Record<string, unknown>): string {
  return interpolate(template, vars, { ausenteVazio: true });
}

// ─── Processor ───────────────────────────────────────────────────────────────

@Processor(CAMPANHA_ENVIO_QUEUE, { concurrency: 3 })
export class CampanhaEnvioProcessor extends WorkerHost {
  private readonly logger = new Logger(CampanhaEnvioProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campanhasService: CampanhasService,
    private readonly whatsapp: WhatsAppService,
    private readonly emailSvc: TransactionalEmailService,
    private readonly campanhaIa: CampanhaIaService,
    private readonly idempotency: IdempotencyService,
    private readonly deadLetter: DeadLetterService,
    private readonly pacing: WhatsappPacingService,
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
    // #34: na ÚLTIMA falha (retries esgotados), o destinatário fica ERRO permanente — dá a chance de
    // finalizar a campanha (senão, se esse era o último pendente, ela ficava presa em ENVIANDO).
    await this.campanhasService.tentarFinalizarCampanha(job.data.campanhaId).catch(() => undefined);
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
        empresaId: dest.campanha.empresaId,
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

    // Guarda o id da mensagem WA (Baileys) pra casar o recibo de leitura → LIDO.
    let waMessageId: string | undefined;

    try {
      const canal = dest.campanha.canal;

      // AUDITORIA P0-1: idempotency claim ANTES de cada side-effect externo.
      // Se retry após sucesso: claim já existe → skip envio.
      if (canal === 'WHATSAPP' || canal === 'WHATSAPP_EMAIL') {
        if (dest.telefone && mensagemWaFinal) {
          const idemKey = `idempotent:campanha:${campanhaId}:${destinatarioId}:wa`;
          // claimStrict: se o Redis cair, PROPAGA o erro (→ catch → ERRO + retry/dead-letter)
          // em vez de virar "skip" e marcar ENVIADO sem ter enviado (perda silenciosa).
          if (await this.idempotency.claimStrict(idemKey, 86_400)) {
            try {
              // Pacing global por empresa (mesmo ponto único de fluxos/bot).
              await this.pacing.aguardarSlot(dest.campanha.empresaId);
              const r = await this.whatsapp.enviarTexto(
                dest.campanha.empresaId,
                dest.telefone,
                mensagemWaFinal,
              );
              waMessageId = r.externalId;
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
          // claimStrict: se o Redis cair, PROPAGA o erro (→ catch → ERRO + retry/dead-letter)
          // em vez de virar "skip" e marcar ENVIADO sem ter enviado (perda silenciosa).
          if (await this.idempotency.claimStrict(idemKey, 86_400)) {
            try {
              // Campanha por e-mail passa pela fachada única (TransactionalEmail →
              // Resend sistêmico, e-mail único da empresa). A fachada NÃO lança: em
              // falha devolve {ok:false}, então re-lançamos pra cair no catch abaixo
              // (libera o idem e marca o destinatário como falho).
              const r = await this.emailSvc.enviarHtmlLivre({
                para: dest.email,
                assunto,
                html: mensagemEmailFinal,
                empresaId: dest.campanha.empresaId, // remetente por-tenant
              });
              if (!r.ok) throw new Error(r.motivo ?? 'falha ao enviar e-mail da campanha');
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
        data: { status: 'ENVIADO', enviadoEm: new Date(), waMessageId },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar para destinatário ${destinatarioId}: ${msg}`);
      await this.prisma.campanhaDestinatario.update({
        where: { id: destinatarioId },
        data: { status: 'ERRO', erro: msg.slice(0, 500) },
      });
      // CAÇADA-BUG #34: RELANÇA pra o BullMQ contar como falha → dispara o retry (attempts:3 + backoff)
      // e, esgotados os retries, o @OnWorkerEvent('failed') manda pro dead-letter. Antes o catch
      // engolia o erro → o job completava "com sucesso" → o retry/dead-letter configurados NUNCA
      // atuavam (um hiccup transitório do Evolution/Resend virava ERRO permanente). A idempotência
      // (idemKey já liberada) garante que o retry não duplica o envio.
      throw err;
    }

    // Só no SUCESSO — no erro, a finalização acontece no onFailed (última falha) ou quando os
    // demais destinatários terminam. Evita finalizar enquanto ainda há retries pendentes.
    await this.campanhasService.tentarFinalizarCampanha(campanhaId);
  }
}
