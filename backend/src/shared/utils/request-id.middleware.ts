import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logContext } from './log-context';

/**
 * Atribui um requestId único a cada requisição + propaga via AsyncLocalStorage
 * para que services e BullMQ jobs vejam o mesmo correlation id (Sprint 3 FIX 4).
 *
 * Honra header `X-Request-Id` quando enviado (útil em integrações).
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    // Sprint 3 FIX 4: propaga requestId via ALS para downstream
    logContext.run({ requestId: id }, () => next());
  }
}
