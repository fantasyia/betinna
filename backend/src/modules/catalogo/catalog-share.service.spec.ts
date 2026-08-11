import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { CatalogShareService } from './catalog-share.service';

const makeEnv = () => ({
  get: (key: string): string => {
    if (key === 'ENCRYPTION_KEY') {
      return '0'.repeat(64); // 32 bytes hex pra test
    }
    return '';
  },
});

describe('CatalogShareService', () => {
  let svc: CatalogShareService;
  let redis: { get: ReturnType<typeof vi.fn>; setEx: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    // #74: revogação por jti — Redis é consultado no validar e escrito no revogar.
    redis = { get: vi.fn().mockResolvedValue(null), setEx: vi.fn().mockResolvedValue(undefined) };
    svc = new CatalogShareService(makeEnv() as never, redis as never);
  });

  it('gerar + validar retorna mesmo payload (roundtrip)', async () => {
    const payload = {
      repId: 'rep-1',
      clienteId: 'cli-1',
      empresaId: 'emp-1',
    };
    const token = await svc.gerar(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // JWT format

    const decoded = await svc.validar(token);
    expect(decoded).toEqual(payload);
  });

  it('token inválido lança UnauthorizedException', async () => {
    await expect(svc.validar('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token assinado com secret diferente é rejeitado', async () => {
    // Gera token com env diferente
    const otherSvc = new CatalogShareService(
      { get: () => 'A'.repeat(64) } as never,
      { get: vi.fn().mockResolvedValue(null), setEx: vi.fn() } as never,
    );
    const token = await otherSvc.gerar({
      repId: 'r',
      clienteId: 'c',
      empresaId: 'e',
    });
    // Tenta validar com nosso svc (secret diferente) — deve falhar
    await expect(svc.validar(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token expirado é rejeitado', async () => {
    // Force TTL muito curto via env
    const origTtl = process.env.CATALOG_SHARE_TTL_SECONDS;
    process.env.CATALOG_SHARE_TTL_SECONDS = '1';
    const shortSvc = new CatalogShareService(makeEnv() as never, redis as never);
    const token = await shortSvc.gerar({ repId: 'r', clienteId: 'c', empresaId: 'e' });

    // Espera mais que 1s
    await new Promise((r) => setTimeout(r, 1100));

    await expect(shortSvc.validar(token)).rejects.toBeInstanceOf(UnauthorizedException);

    // Restaura
    if (origTtl !== undefined) process.env.CATALOG_SHARE_TTL_SECONDS = origTtl;
    else delete process.env.CATALOG_SHARE_TTL_SECONDS;
  });

  it('payload inclui repId, clienteId e empresaId', async () => {
    const token = await svc.gerar({
      repId: 'rep-X',
      clienteId: 'cli-Y',
      empresaId: 'emp-Z',
    });
    const p = await svc.validar(token);
    expect(p.repId).toBe('rep-X');
    expect(p.clienteId).toBe('cli-Y');
    expect(p.empresaId).toBe('emp-Z');
  });
});

describe('CatalogShareService — revogação de link (#74)', () => {
  const env = { get: vi.fn().mockReturnValue('k'.repeat(64)) };

  it('token revogado deixa de valer ANTES do TTL', async () => {
    const redisLocal = { get: vi.fn(), setEx: vi.fn().mockResolvedValue(undefined) };
    const s = new CatalogShareService(env as never, redisLocal as never);
    const token = await s.gerar({ repId: 'rep-1', empresaId: 'emp-1' });

    // Antes de revogar: vale.
    redisLocal.get.mockResolvedValue(null);
    await expect(s.validar(token)).resolves.toMatchObject({ repId: 'rep-1' });

    // Revoga e o validar passa a recusar.
    await s.revogar(token);
    expect(redisLocal.setEx).toHaveBeenCalled();
    redisLocal.get.mockResolvedValue('1');
    await expect(s.validar(token)).rejects.toThrow(/revogado|expirado|inválido/i);
  });

  it('Redis fora no validar → FAIL-OPEN (link segue valendo)', async () => {
    // Derrubar o catálogo de todos os reps por indisponibilidade do Redis seria
    // pior que o risco de um link revogado sobreviver alguns minutos.
    const redisLocal = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      setEx: vi.fn(),
    };
    const s = new CatalogShareService(env as never, redisLocal as never);
    const token = await s.gerar({ repId: 'rep-1', empresaId: 'emp-1' });

    await expect(s.validar(token)).resolves.toMatchObject({ repId: 'rep-1' });
  });

  it('cada link tem jti próprio — revogar um não derruba o outro', async () => {
    const redisLocal = {
      get: vi.fn().mockResolvedValue(null),
      setEx: vi.fn().mockResolvedValue(undefined),
    };
    const s = new CatalogShareService(env as never, redisLocal as never);
    const t1 = await s.gerar({ repId: 'rep-1', empresaId: 'emp-1' });
    const t2 = await s.gerar({ repId: 'rep-1', empresaId: 'emp-1' });

    await s.revogar(t1);
    const chave1 = redisLocal.setEx.mock.calls[0][0] as string;
    await s.revogar(t2);
    const chave2 = redisLocal.setEx.mock.calls[1][0] as string;

    expect(chave1).not.toBe(chave2);
  });
});

/**
 * #74: o `revogar` existia mas nenhum endpoint chamava — o gancho era
 * decorativo e um link vazado ficava aberto até o TTL de 7 dias.
 */
describe('CatalogShareService.revogarComoUsuario', () => {
  const makeSvc = () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setEx: vi.fn().mockResolvedValue(undefined),
    };
    return { svc: new CatalogShareService(makeEnv() as never, redis as never), redis };
  };

  it('REP dono revoga o próprio link (e o token para de valer)', async () => {
    const { svc, redis } = makeSvc();
    const token = await svc.gerar({ repId: 'rep-1', clienteId: 'c', empresaId: 'emp-1' });

    await svc.revogarComoUsuario({ id: 'rep-1', role: 'REP', empresaIdAtiva: 'emp-1' }, token);

    expect(redis.setEx).toHaveBeenCalledWith(
      expect.stringContaining('share:revogado:'),
      '1',
      expect.any(Number),
    );
  });

  it('REP NÃO derruba link de outro rep', async () => {
    const { svc, redis } = makeSvc();
    const token = await svc.gerar({ repId: 'rep-1', empresaId: 'emp-1' });

    await expect(
      svc.revogarComoUsuario({ id: 'rep-2', role: 'REP', empresaIdAtiva: 'emp-1' }, token),
    ).rejects.toThrow(/representante dono/i);
    expect(redis.setEx).not.toHaveBeenCalled();
  });

  it('DIRECTOR derruba qualquer link da própria empresa', async () => {
    const { svc, redis } = makeSvc();
    const token = await svc.gerar({ repId: 'rep-1', empresaId: 'emp-1' });

    await svc.revogarComoUsuario({ id: 'dir', role: 'DIRECTOR', empresaIdAtiva: 'emp-1' }, token);

    expect(redis.setEx).toHaveBeenCalledTimes(1);
  });

  it('link de OUTRA empresa é barrado (multi-tenant)', async () => {
    const { svc } = makeSvc();
    const token = await svc.gerar({ repId: 'rep-1', empresaId: 'emp-1' });

    await expect(
      svc.revogarComoUsuario({ id: 'dir', role: 'ADMIN', empresaIdAtiva: 'emp-OUTRA' }, token),
    ).rejects.toThrow(/outra empresa/i);
  });
});
