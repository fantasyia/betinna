import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import { AUDIT_KEY, type AuditMetadata } from '@shared/decorators/audit.decorator';
import { AuditService } from './audit.service';

/**
 * Interceptor que grava audit log automaticamente quando o endpoint
 * estiver marcado com `@Audit({ action, resource })`.
 *
 * Roda APÓS o handler completar com sucesso. Falhas não geram log
 * (são tratadas pelo AllExceptionsFilter).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      tap((response) => {
        const recursoId = this.extractResourceId(meta.resourceIdFrom, req, response);

        this.audit.log({
          usuarioId: req.user?.id ?? null,
          empresaId: req.user?.empresaIdAtiva ?? null,
          acao: meta.action,
          recurso: meta.resource,
          recursoId,
          detalhes: {
            method: req.method,
            path: req.path,
            requestId: req.id,
          },
          ip: req.ip ?? null,
        });
      }),
    );
  }

  private extractResourceId(
    source: AuditMetadata['resourceIdFrom'],
    req: Request,
    response: unknown,
  ): string | null {
    if (!source) return null;
    const [bucket, key] = source.split('.') as ['params' | 'body' | 'response', string];
    if (!key) return null;

    let raw: unknown;
    if (bucket === 'params') raw = req.params?.[key];
    else if (bucket === 'body') {
      const body = req.body as Record<string, unknown> | undefined;
      raw = body?.[key];
    } else if (bucket === 'response') {
      // #R8 — o AuditInterceptor é OUTER em relação ao ResponseInterceptor (registrado antes), então
      // `response` aqui JÁ é o envelope `{ success, data, meta }`. O recurso real (id do recém-criado)
      // está em `data`. Sem desembrulhar, `resp.id` era sempre undefined → recursoId NULL em ~10
      // endpoints de create com `resourceIdFrom: 'response.id'` (agenda, amostra, campanha, etc.).
      const resp = response as Record<string, unknown> | undefined;
      const payload =
        resp && typeof resp === 'object' && 'success' in resp && 'data' in resp
          ? (resp.data as Record<string, unknown> | undefined)
          : resp;
      raw = payload?.[key];
    }
    return typeof raw === 'string' ? raw : null;
  }
}
