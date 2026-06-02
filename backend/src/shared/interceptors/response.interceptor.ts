import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { type Observable, map } from 'rxjs';

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta: {
    path: string;
    method: string;
    timestamp: string;
    requestId?: string;
  };
}

/**
 * #17 (Fase 0) — converte Prisma.Decimal → number recursivamente em toda resposta.
 *
 * Prisma serializa Decimal como STRING no JSON; sem isto, migrar uma coluna de
 * dinheiro pra Decimal quebraria os números/gráficos no frontend. Convertendo no
 * boundary, o front continua recebendo `number` como sempre. Preserva Date e
 * Buffer (não vira objeto vazio).
 */
function convertDecimals(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(convertDecimals);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out[k] = convertDecimals((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * Envelopa toda resposta de sucesso no formato `{ success, data, meta }`.
 * Quando o controller já retorna esse formato (ex: respostas paginadas),
 * ele é preservado.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, SuccessResponse<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessResponse<T> | T> {
    const request = context.switchToHttp().getRequest<Request & { id?: string }>();
    return next.handle().pipe(
      map((raw) => {
        // Resposta sem corpo (204)
        if (raw === undefined || raw === null) {
          return raw;
        }
        // Decimal → number em qualquer ponto do payload (#17 Fase 0).
        const data = convertDecimals(raw) as T;
        // Já envelopada (ex: respostas paginadas) — preserva o envelope.
        if (typeof data === 'object' && data !== null && 'success' in data) {
          return data;
        }
        return {
          success: true as const,
          data,
          meta: {
            path: request.url,
            method: request.method,
            timestamp: new Date().toISOString(),
            requestId: request.id,
          },
        };
      }),
    );
  }
}
