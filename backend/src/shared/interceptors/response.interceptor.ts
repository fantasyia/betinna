import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
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
 * Envelopa toda resposta de sucesso no formato `{ success, data, meta }`.
 * Quando o controller já retorna esse formato (ex: respostas paginadas),
 * ele é preservado.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, SuccessResponse<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessResponse<T> | T> {
    const request = context.switchToHttp().getRequest<Request & { id?: string }>();
    return next.handle().pipe(
      map((data) => {
        // Resposta sem corpo (204) ou já envelopada
        if (data === undefined || data === null) {
          return data;
        }
        if (typeof data === 'object' && 'success' in data) {
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
