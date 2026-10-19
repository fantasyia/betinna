import { describe, expect, it, vi } from 'vitest';
import { ModoInternoService, codigoConfere, codigoInterno, ipUtil } from './modo-interno.service';

/** Modo interno da vitrine (#04/Léo, 19/10): visita da equipe não conta. */

const CHAVE = 'a'.repeat(64);

function montar(o: { doApp?: string[]; manuais?: string[] } = {}) {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue((o.doApp ?? []).map((ip) => ({ ip }))),
    empresa: {
      findUnique: vi.fn().mockResolvedValue({ config: { interno: { ips: o.manuais ?? [] } } }),
    },
  };
  const env = { get: (k: string) => (k === 'ENCRYPTION_KEY' ? CHAVE : undefined) };
  return { svc: new ModoInternoService(prisma as never, env as never), prisma };
}

describe('código do link "marcar este aparelho"', () => {
  it('estável por empresa, diferente entre empresas, e só ele confere', () => {
    const a = codigoInterno('emp-1', CHAVE);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(codigoInterno('emp-1', CHAVE)).toBe(a);
    expect(codigoInterno('emp-2', CHAVE)).not.toBe(a);
    expect(codigoConfere('emp-1', CHAVE, a)).toBe(true);
    expect(codigoConfere('emp-2', CHAVE, a)).toBe(false);
    expect(codigoConfere('emp-1', CHAVE, 'x')).toBe(false);
    expect(codigoConfere('emp-1', '', a)).toBe(false);
  });
});

describe('ipUtil', () => {
  it('fica com IP público; descarta loopback, rede interna e o proxy', () => {
    expect(ipUtil('46.151.1.2')).toBe('46.151.1.2');
    expect(ipUtil('::ffff:45.188.1.1')).toBe('45.188.1.1');
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.9',
      '172.20.0.1',
      '100.64.0.5',
      '::1',
      '',
      null,
    ]) {
      expect(ipUtil(ip)).toBeNull();
    }
  });
});

describe('ehInterno', () => {
  it('IP que um usuário da empresa já usou no app, IP cadastrado à mão, ou o código do link', async () => {
    const { svc } = montar({ doApp: ['46.151.1.2', '127.0.0.1'], manuais: ['45.188.1.1'] });
    expect(await svc.ehInterno('emp-1', '46.151.1.2')).toBe(true);
    expect(await svc.ehInterno('emp-1', '45.188.1.1')).toBe(true);
    expect(await svc.ehInterno('emp-1', '200.1.1.1')).toBe(false);
    expect(await svc.ehInterno('emp-1', '200.1.1.1', codigoInterno('emp-1', CHAVE))).toBe(true);
    expect(await svc.ehInterno('emp-1', '127.0.0.1')).toBe(false); // loopback nunca
  });

  it('cache de 10 min: não consulta o histórico a cada visita', async () => {
    const { svc, prisma } = montar({ doApp: ['46.151.1.2'] });
    await svc.ehInterno('emp-1', '1.1.1.1');
    await svc.ehInterno('emp-1', '2.2.2.2');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('banco fora do ar: NÃO é interno (na dúvida, mede)', async () => {
    const { svc, prisma } = montar();
    prisma.$queryRaw.mockRejectedValue(new Error('caiu'));
    expect(await svc.ehInterno('emp-1', '46.151.1.2')).toBe(false);
  });
});
