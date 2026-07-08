import { describe, expect, it, vi, beforeEach } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { AuditMetadata } from '@shared/decorators/audit.decorator';
import { AuditInterceptor } from './audit.interceptor';

const makeCtx = (req: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

const makeHandler = (response: unknown): CallHandler => ({ handle: () => of(response) });

describe('AuditInterceptor', () => {
  let audit: { log: ReturnType<typeof vi.fn> };
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
  let interceptor: AuditInterceptor;

  const baseReq = {
    user: { id: 'u-1', empresaIdAtiva: 'emp-1' },
    method: 'POST',
    path: '/agenda',
    id: 'req-1',
    ip: '127.0.0.1',
    params: {},
    body: {},
  };

  const runComMeta = async (meta: AuditMetadata, response: unknown, req = baseReq) => {
    reflector.getAllAndOverride.mockReturnValue(meta);
    const result$ = interceptor.intercept(makeCtx(req), makeHandler(response));
    await firstValueFrom(result$);
    return audit.log.mock.calls[0]?.[0];
  };

  beforeEach(() => {
    audit = { log: vi.fn() };
    reflector = { getAllAndOverride: vi.fn() };
    interceptor = new AuditInterceptor(reflector as never, audit as never);
  });

  it('#R8: response.id desembrulha o envelope { success, data } → recursoId correto', async () => {
    // O AuditInterceptor é OUTER: recebe a resposta JÁ envelopada pelo ResponseInterceptor.
    const enveloped = { success: true, data: { id: 'novo-123' }, meta: {} };
    const logged = await runComMeta(
      { action: 'create', resource: 'agenda', resourceIdFrom: 'response.id' },
      enveloped,
    );
    expect(logged.recursoId).toBe('novo-123'); // antes: null (lia envelope.id → undefined)
  });

  it('response não-envelopada (fallback) ainda funciona', async () => {
    const logged = await runComMeta(
      { action: 'create', resource: 'x', resourceIdFrom: 'response.id' },
      { id: 'cru-9' },
    );
    expect(logged.recursoId).toBe('cru-9');
  });

  it('params.id continua sendo lido do request', async () => {
    const logged = await runComMeta(
      { action: 'update', resource: 'x', resourceIdFrom: 'params.id' },
      { success: true, data: {} },
      { ...baseReq, params: { id: 'p-42' } },
    );
    expect(logged.recursoId).toBe('p-42');
  });

  it('sem @Audit não registra nada', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await firstValueFrom(interceptor.intercept(makeCtx(baseReq), makeHandler({ id: 'x' })));
    expect(audit.log).not.toHaveBeenCalled();
  });
});
