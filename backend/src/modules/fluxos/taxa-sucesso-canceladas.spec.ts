import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxosService } from './fluxos.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * Taxa de sucesso conta só o que TERMINOU.
 *
 * O caso real (25/08): os fluxos C1 e C2 do bot mostravam ~11% de sucesso sem
 * UM erro sequer. Em 7 dias o C1 tinha 14 CANCELADAS, 2 AGUARDANDO e 2
 * CONCLUÍDAS — e a conta era `concluídas / total`. Cancelamento ali é o
 * desenho: cada mensagem nova do mesmo lead cancela a execução anterior.
 * Contar isso como fracasso pinta de vermelho um fluxo saudável.
 */
const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'emp1' } as AuthenticatedUser;

function makeService() {
  const fluxo = { id: 'f1', empresaId: 'emp1', nome: 'C1', status: 'ATIVO', nos: [] };
  const prisma = {
    fluxo: {
      findFirst: vi.fn().mockResolvedValue(fluxo),
      findUniqueOrThrow: vi.fn().mockResolvedValue(fluxo),
    },
    fluxoExecucao: { count: vi.fn().mockResolvedValue(0) },
  };
  const svc = new FluxosService(
    prisma as never,
    { dispararDireto: vi.fn() } as never,
    { del: vi.fn() } as never,
    { uploadOutbound: vi.fn() } as never,
  );
  return { svc, prisma };
}

/** Ordem das contagens em `metricas`: total, concluídos, falhos, em execução, testes. */
const contagens = (
  prisma: { fluxoExecucao: { count: ReturnType<typeof vi.fn> } },
  vals: number[],
) => {
  let i = 0;
  prisma.fluxoExecucao.count.mockImplementation(() => Promise.resolve(vals[i++] ?? 0));
};

describe('taxa de sucesso × execuções canceladas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('o C1 real: 18 execuções, 14 canceladas, 2 em espera, 2 ok, 0 erro → 100%', async () => {
    const { svc, prisma } = makeService();
    contagens(prisma, [18, 2, 0, 0, 0]);

    const m = await svc.metricas(user, 'f1');

    // Antes dava 11% (2/18) e o dashboard acusava o fluxo de estar quebrado.
    expect(m.taxaSucesso).toBe(100);
    // O total continua sendo o volume real — quem lê a linha vê que rodou 18x.
    expect(m.total).toBe(18);
  });

  it('erro de verdade continua derrubando a taxa', async () => {
    const { svc, prisma } = makeService();
    contagens(prisma, [20, 6, 2, 0, 0]);

    // 6 ok de 8 terminadas = 75%. As 12 canceladas não entram em lado nenhum.
    expect((await svc.metricas(user, 'f1')).taxaSucesso).toBe(75);
  });

  it('só falha: 0%, e não "sem dado"', async () => {
    const { svc, prisma } = makeService();
    contagens(prisma, [5, 0, 3, 0, 0]);

    expect((await svc.metricas(user, 'f1')).taxaSucesso).toBe(0);
  });

  it('nada terminou (só canceladas/em voo) → 0, sem divisão por zero', async () => {
    const { svc, prisma } = makeService();
    contagens(prisma, [9, 0, 0, 4, 0]);

    const m = await svc.metricas(user, 'f1');
    expect(m.taxaSucesso).toBe(0);
    expect(Number.isNaN(m.taxaSucesso)).toBe(false);
  });
});
