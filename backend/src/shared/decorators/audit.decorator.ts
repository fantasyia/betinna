import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

/**
 * Define de onde o interceptor deve extrair o ID do recurso afetado.
 * Formato: `params.<chave>` | `body.<chave>` | `response.<chave>`.
 * Exemplos válidos:
 *   - 'params.id'
 *   - 'params.clienteId'
 *   - 'body.id'
 *   - 'response.id'
 */
export type AuditResourceIdSource = `params.${string}` | `body.${string}` | `response.${string}`;

export interface AuditMetadata {
  action: string;
  resource: string;
  resourceIdFrom?: AuditResourceIdSource;
}

/**
 * Marca um endpoint para registro no audit log.
 * O AuditInterceptor lê essa metadata e grava após sucesso.
 *
 * @example
 *   @Audit({ action: 'create', resource: 'cliente', resourceIdFrom: 'response.id' })
 *   @Post()
 */
export const Audit = (meta: AuditMetadata): MethodDecorator =>
  SetMetadata(AUDIT_KEY, meta) as MethodDecorator;
