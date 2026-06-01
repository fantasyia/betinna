/**
 * Dead Letter Queue — captura jobs BullMQ que falharam todas as tentativas.
 *
 * Cada queue produtora (campanha-envio, fluxo-execucao) ouve seu próprio
 * `worker.on('failed')` e, quando `attemptsMade >= maxAttempts`, enfileira
 * aqui um job descritivo. O processor:
 *   - Loga em AuditLog (auditoria permanente)
 *   - Alerta diretor da empresa via Resend (best-effort)
 *
 * Retry a partir do dead-letter é feito via endpoint admin
 * `POST /admin/dead-letter/:id/retry` — empurra de volta na queue original.
 */

export const DEAD_LETTER_QUEUE = 'dead-letter';

export interface DeadLetterJobData {
  /** Queue de origem (campanha-envio, fluxo-execucao, etc.) */
  originalQueue: string;
  /** ID original do job que falhou. */
  originalJobId: string;
  /** Nome do job original (action). */
  originalJobName: string;
  /** Payload original (preservado pra retry). */
  originalData: Record<string, unknown>;
  /** Mensagem de erro do último attempt. */
  error: string;
  /** Stack do erro (truncado). */
  stack?: string;
  /** ISO timestamp do failed-final. */
  failedAt: string;
  /** Tenant afetado (quando inferível do payload). */
  empresaId?: string;
}
