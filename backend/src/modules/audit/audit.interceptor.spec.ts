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

/**
 * O R2 saiu de ATIVO pra RASCUNHO em 24/09 e ninguém soube quem foi: a escrita
 * entrou por token de API, que chega como o DONO do token. Estes testes travam
 * o que separa a tela do MCP — e o que diferencia "renomeou" de "trocou o grafo".
 */
describe('AuditInterceptor — por onde veio e o que mudou', () => {
  const base = {
    user: { id: 'u-1', empresaIdAtiva: 'emp-1' },
    method: 'PUT',
    path: '/fluxos/f1',
    id: 'r',
    ip: '1',
    params: { id: 'f1' },
  };
  const rodar = async (req: Record<string, unknown>) => {
    const audit = { log: vi.fn() };
    const interceptor = new AuditInterceptor(
      {
        getAllAndOverride: vi
          .fn()
          .mockReturnValue({ action: 'update', resource: 'fluxo', resourceIdFrom: 'params.id' }),
      } as never,
      audit as never,
    );
    await firstValueFrom(
      interceptor.intercept(makeCtx(req), makeHandler({ success: true, data: {} })),
    );
    return audit.log.mock.calls[0][0].detalhes as Record<string, unknown>;
  };

  it('token de API: grava via=api_token + id e nome do token', async () => {
    const d = await rodar({ ...base, body: {}, apiToken: { id: 'tok-9', nome: 'Claude master' } });
    expect(d).toMatchObject({
      via: 'api_token',
      apiTokenId: 'tok-9',
      apiTokenNome: 'Claude master',
    });
  });

  it('tela: via=sessao, sem campos de token', async () => {
    const d = await rodar({ ...base, body: {} });
    expect(d.via).toBe('sessao');
    expect(d).not.toHaveProperty('apiTokenId');
  });

  it('grava os NOMES dos campos enviados — e nunca os valores', async () => {
    const d = await rodar({
      ...base,
      body: { nome: 'R2', nos: [{ texto: 'dado do cliente' }], arestas: [] },
    });
    expect(d.campos).toEqual(['arestas', 'nome', 'nos']);
    expect(JSON.stringify(d)).not.toContain('dado do cliente');
  });

  it('corpo vazio ou ausente não gera "campos"', async () => {
    expect(await rodar({ ...base, body: {} })).not.toHaveProperty('campos');
    expect(await rodar({ ...base, body: undefined })).not.toHaveProperty('campos');
  });
});
