import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { DevolucoesService } from './devolucoes.service';

const user: AuthenticatedUser = {
  id: 'dir',
  email: 'd@x.com',
  nome: 'Dir',
  role: 'DIRECTOR' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
};

/** Devolução em EM_ANALISE (pronta pra decisão) apontando pro pedido. */
function devExistente(over: Record<string, unknown> = {}) {
  return {
    id: 'dev-1',
    numero: 'DEV-0001',
    empresaId: 'emp-1',
    pedidoId: 'ped-1',
    status: 'EM_ANALISE',
    valorDevolvido: null,
    criadoPorId: 'dir',
    ...over,
  };
}

function makePrisma(dev: Record<string, unknown>, pedido: Record<string, unknown>, estorno = true) {
  const tx = {
    devolucao: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    pedido: {
      findUnique: vi.fn().mockResolvedValue(pedido),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    tx,
    prisma: {
      devolucao: {
        findFirst: vi.fn().mockResolvedValue(dev),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...dev, status: 'APROVADA' }),
      },
      empresa: {
        findUnique: vi.fn().mockResolvedValue({
          config: { devolucaoInterna: { estornoComissaoProporcional: estorno } },
        }),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
}
const repScope = { getRepIds: vi.fn().mockResolvedValue(null) }; // DIRECTOR vê tudo
const sequence = { next: vi.fn() };

function make(dev: Record<string, unknown>, pedido: Record<string, unknown>, estorno = true) {
  const { prisma, tx } = makePrisma(dev, pedido, estorno);
  const svc = new DevolucoesService(prisma as never, repScope as never, sequence as never);
  return { svc, tx, prisma };
}

describe('DevolucoesService — estorno de comissão na APROVADA', () => {
  beforeEach(() => vi.clearAllMocks());

  it('estorno PROPORCIONAL ao valorDevolvido informado', async () => {
    // pedido: total 100, comissão 10. Devolvido 50 → estorno = 10 × 50/100 = 5.
    const { svc, tx } = make(devExistente({ valorDevolvido: 50 }), {
      total: 100,
      comissao: 10,
      comissaoEstornada: 0,
      valorDevolvido: 0,
    });
    await svc.mudarStatus(user, 'dev-1', { status: 'APROVADA' } as never);
    expect(tx.pedido.update).toHaveBeenCalledTimes(1);
    expect(tx.pedido.update.mock.calls[0][0].data).toEqual({
      comissaoEstornada: { increment: 5 },
      valorDevolvido: { increment: 50 },
    });
  });

  it('devolução TOTAL (valorDevolvido null) estorna a comissão inteira', async () => {
    const { svc, tx } = make(devExistente({ valorDevolvido: null }), {
      total: 100,
      comissao: 10,
      comissaoEstornada: 0,
      valorDevolvido: 0,
    });
    await svc.mudarStatus(user, 'dev-1', { status: 'APROVADA' } as never);
    expect(tx.pedido.update.mock.calls[0][0].data).toEqual({
      comissaoEstornada: { increment: 10 },
      valorDevolvido: { increment: 100 },
    });
  });

  it('config estorno DESLIGADA → não estorna', async () => {
    const { svc, tx } = make(
      devExistente({ valorDevolvido: 50 }),
      { total: 100, comissao: 10, comissaoEstornada: 0, valorDevolvido: 0 },
      false,
    );
    await svc.mudarStatus(user, 'dev-1', { status: 'APROVADA' } as never);
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });

  it('RECUSADA não estorna', async () => {
    const { svc, tx } = make(devExistente({ valorDevolvido: 50 }), {
      total: 100,
      comissao: 10,
      comissaoEstornada: 0,
      valorDevolvido: 0,
    });
    await svc.mudarStatus(user, 'dev-1', {
      status: 'RECUSADA',
      motivoRecusa: 'fora da política',
    } as never);
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });

  it('clamp: não estorna além da comissão restante do pedido', async () => {
    // comissão 10, já estornado 8 → resta 2, mesmo que o proporcional dê 10.
    const { svc, tx } = make(devExistente({ valorDevolvido: null }), {
      total: 100,
      comissao: 10,
      comissaoEstornada: 8,
      valorDevolvido: 100,
    });
    await svc.mudarStatus(user, 'dev-1', { status: 'APROVADA' } as never);
    // valorDevolvido restante = 0 (já 100 de 100) → não estorna nada.
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });
});
