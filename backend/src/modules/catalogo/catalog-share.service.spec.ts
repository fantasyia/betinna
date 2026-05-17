import { beforeEach, describe, expect, it } from 'vitest';
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

  beforeEach(() => {
    svc = new CatalogShareService(makeEnv() as never);
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
    const otherSvc = new CatalogShareService({
      get: () => 'A'.repeat(64),
    } as never);
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
    const shortSvc = new CatalogShareService(makeEnv() as never);
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
