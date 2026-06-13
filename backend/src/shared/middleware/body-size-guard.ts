import type { Request, Response, NextFunction } from 'express';

/**
 * Guard de tamanho de corpo por rota — defesa em profundidade contra payloads
 * gigantes.
 *
 * Contexto: o body-parser global aceita até 20MB (necessário pra upload de mídia
 * no Inbox e webhooks batched). Mas a MAIORIA das rotas (CRUD normal) nunca
 * precisa disso — deixar 20MB pra todas amplia a superfície de DoS (um corpo de
 * 20MB por request consome memória antes de qualquer validação).
 *
 * Este guard roda ANTES do body-parser e rejeita (413) com base no header
 * `Content-Length`, ANTES de alocar o corpo inteiro. Só rotas que legitimamente
 * recebem payload grande (`/webhooks/*`, `/inbox/*`, `/import/*`) mantêm o teto
 * de 20MB; o resto cai pra 1MB.
 *
 * IMPORTANTE: NÃO toca no corpo nem no `req.rawBody` — só lê um header. Por isso
 * a verificação HMAC dos webhooks (que depende do rawBody) fica 100% intacta. O
 * parser global de 20MB segue como backstop pra requests sem Content-Length
 * (ex.: transfer-encoding chunked).
 */

const MB = 1024 * 1024;

/** Rotas que legitimamente recebem corpo grande (independe do prefixo /api/v1). */
const ROTA_CORPO_GRANDE = /\/(webhooks|inbox|import)\//;

export const LIMITE_CORPO_GRANDE_BYTES = 20 * MB;
export const LIMITE_CORPO_PADRAO_BYTES = 1 * MB;

/** Limite de bytes permitido pra um dado caminho de request. */
export function limiteCorpoPara(path: string): number {
  return ROTA_CORPO_GRANDE.test(path) ? LIMITE_CORPO_GRANDE_BYTES : LIMITE_CORPO_PADRAO_BYTES;
}

export function bodySizeGuard(req: Request, res: Response, next: NextFunction): void {
  const len = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(len) && len > limiteCorpoPara(req.path)) {
    res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Corpo da requisição excede o limite permitido para esta rota.',
      },
    });
    return;
  }
  next();
}
