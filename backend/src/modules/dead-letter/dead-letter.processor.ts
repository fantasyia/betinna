import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '@database/prisma.service';
import { SendGridService } from '@integrations/sendgrid/sendgrid.service';
import { captureException as sentryCapture } from '@shared/observability/sentry';
import { DEAD_LETTER_QUEUE, type DeadLetterJobData } from './dead-letter.types';

/**
 * Processor da Dead Letter Queue (Sprint 3 FIX 3).
 *
 * Para cada job que esgotou retries:
 *  1. Loga em AuditLog (auditoria permanente — sobrevive a Redis restart)
 *  2. Tenta notificar o DIRETOR da empresa (best-effort via SendGrid sistêmico).
 *     Falha de notificação NÃO causa retry deste job (attempts: 1).
 *
 * Concurrency 1 — não é um caminho hot, e queremos audit log ordenado.
 */
@Processor(DEAD_LETTER_QUEUE, { concurrency: 1 })
export class DeadLetterProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadLetterProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sendgrid: SendGridService,
  ) {
    super();
  }

  async process(job: Job<DeadLetterJobData>): Promise<void> {
    const d = job.data;
    this.logger.error(
      `Dead-letter: queue=${d.originalQueue} job=${d.originalJobId} empresaId=${d.empresaId ?? '(n/a)'} err="${d.error}"`,
    );

    // Sprint 3 FIX 5: reporta no Sentry — visibilidade fora do log do server
    sentryCapture(new Error(`Job failed permanently: ${d.error}`), {
      originalQueue: d.originalQueue,
      originalJobName: d.originalJobName,
      originalJobId: d.originalJobId,
      empresaId: d.empresaId,
      failedAt: d.failedAt,
    });

    // 1) Audit log permanente
    await this.prisma.auditLog
      .create({
        data: {
          usuarioId: null,
          empresaId: d.empresaId ?? null,
          acao: 'job_failed',
          recurso: d.originalQueue,
          recursoId: d.originalJobId,
          detalhes: {
            originalJobName: d.originalJobName,
            error: d.error,
            stack: d.stack ?? null,
            failedAt: d.failedAt,
            payloadKeys: Object.keys(d.originalData ?? {}),
          },
        },
      })
      .catch((err) => {
        this.logger.error(
          `Falha persistindo audit log do dead-letter: ${err instanceof Error ? err.message : err}`,
        );
      });

    // 2) Notifica diretor (best-effort) — só se empresaId presente
    if (d.empresaId) {
      await this.notificarDiretor(d).catch((err) => {
        this.logger.warn(
          `Falha notificando diretor (empresa=${d.empresaId}): ${err instanceof Error ? err.message : err}`,
        );
      });
    }
  }

  private async notificarDiretor(d: DeadLetterJobData): Promise<void> {
    if (!d.empresaId) return;
    const diretor = await this.prisma.usuario.findFirst({
      where: {
        role: 'DIRECTOR',
        status: 'ATIVO',
        empresas: { some: { empresaId: d.empresaId } },
      },
      select: { id: true, email: true, nome: true },
    });
    if (!diretor) {
      this.logger.debug(
        `Sem DIRECTOR ativo na empresa ${d.empresaId} — alerta de dead-letter não enviado`,
      );
      return;
    }
    const assunto = `[Betinna.ai] Job falhou após retries — ${d.originalQueue}`;
    const corpoHtml = `
      <p>Olá ${diretor.nome},</p>
      <p>Um processamento em background falhou após esgotar todas as tentativas.</p>
      <ul>
        <li><b>Tipo:</b> ${escapeHtml(d.originalJobName)}</li>
        <li><b>Queue:</b> ${escapeHtml(d.originalQueue)}</li>
        <li><b>Ocorrência:</b> ${escapeHtml(d.failedAt)}</li>
        <li><b>Erro:</b> ${escapeHtml(d.error)}</li>
      </ul>
      <p>A equipe técnica recebeu o registro detalhado e investigará. Caso urgente, contate o suporte.</p>
      <p style="color:#888;font-size:12px">Mensagem automática — não responda.</p>
    `;
    await this.sendgrid.enviarSistemico({
      para: { email: diretor.email, name: diretor.nome },
      assunto,
      html: corpoHtml,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}
