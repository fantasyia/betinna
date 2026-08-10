import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BadgesService } from './badges.service';

const fakeUser = (role: UserRole): AuthenticatedUser => ({
  id: 'u-1',
  email: 'u@x.com',
  nome: 'U',
  role,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
});

const makePrisma = () => ({
  conversation: { count: vi.fn().mockResolvedValue(3) },
  aprovacaoDesconto: { count: vi.fn().mockResolvedValue(12) },
  pedidoCancelamentoSolicitacao: { count: vi.fn().mockResolvedValue(4) },
});

describe('BadgesService — badge de vendas por papel (auditoria média)', () => {
  let prisma: ReturnType<typeof makePrisma>;

  const montar = (scope: string[] | null) =>
    new BadgesService(prisma as never, { getRepIds: vi.fn().mockResolvedValue(scope) } as never);

  beforeEach(() => {
    prisma = makePrisma();
  });

  it.each(['ADMIN', 'DIRECTOR', 'GERENTE'] as const)('%s vê o badge de vendas', async (role) => {
    const r = await montar(role === 'GERENTE' ? ['rep-1'] : null).getBadges(fakeUser(role));
    expect(r.vendas).toBe(16); // 12 aprovações + 4 cancelamentos
  });

  it('SAC NÃO vê badge de vendas — o RepScope devolve null pra ele, então o contador somava a EMPRESA INTEIRA de um módulo que ele nem acessa', async () => {
    const r = await montar(null).getBadges(fakeUser('SAC' as UserRole));

    expect(r.vendas).toBe(0);
    // E nem chega a consultar — badge é isca: mostrar número que dá 403 no clique.
    expect(prisma.aprovacaoDesconto.count).not.toHaveBeenCalled();
    expect(prisma.pedidoCancelamentoSolicitacao.count).not.toHaveBeenCalled();
  });

  it('REP continua sem badge de vendas (ele não aprova)', async () => {
    const r = await montar(['u-1']).getBadges(fakeUser('REP' as UserRole));
    expect(r.vendas).toBe(0);
  });
});
