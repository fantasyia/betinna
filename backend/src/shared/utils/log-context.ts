import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto por requisição/job — propagado via AsyncLocalStorage.
 *
 * Permite que services profundos (e workers BullMQ) registrem logs com
 * o `requestId` original sem precisarem receber em todo método.
 *
 * Uso:
 *   // No middleware/processor:
 *   logContext.run({ requestId, jobId, queue, empresaId }, () => { ... })
 *
 *   // Em qualquer lugar abaixo da stack:
 *   const ctx = logContext.getStore()
 */
export interface LogContext {
  requestId?: string;
  jobId?: string;
  queue?: string;
  empresaId?: string;
  userId?: string;
}

export const logContext = new AsyncLocalStorage<LogContext>();

/**
 * Atualiza valores no contexto atual (não cria um novo store — preserva o
 * existente, útil em handlers que querem enriquecer).
 */
export function enrichLogContext(updates: Partial<LogContext>): void {
  const store = logContext.getStore();
  if (store) Object.assign(store, updates);
}
