import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PedidoComissoesService } from './pedido-comissoes.service';

const makePrisma = () => ({
  pedido: { findUnique: vi.fn() },
  usuario: { findUnique: vi.fn(), findMany: vi.fn(async () => [] as unknown[]) },
  pedidoComissao: { deleteMany: vi.fn(async () => ({ count: 0 })), upsert: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
});
let tx: {
  pedidoComissao: { deleteMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
};

describe('PedidoComissoesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: PedidoComissoesService;

  const pedido = (over: Record<string, unknown> = {}) => ({
    id: 'ped-1',
    empresaId: 'emp-1',
    origem: 'SITE',
    status: 'ENVIADO_ERP',
    total: new Prisma.Decimal('50.00'),
    valorDevolvido: null,
    representanteId: null,
    ...over,
  });

  beforeEach(() => {
    tx = {
      pedidoComissao: { deleteMany: vi.fn(async () => ({ count: 0 })), upsert: vi.fn() },
    };
    prisma = makePrisma();
    svc = new PedidoComissoesService(prisma as never);
  });

  it('venda de canal: uma linha por pessoa com % de site', async () => {
    prisma.pedido.findUnique.mockResolvedValue(pedido());
    prisma.usuario.findMany.mockResolvedValue([
      { id: 'leo', comissaoSite: 7.25 },
      { id: 'harada', comissaoSite: 7.25 },
    ]);

    await svc.recalcular('ped-1');

    expect(tx.pedidoComissao.upsert).toHaveBeenCalledTimes(2);
    const criadas = tx.pedidoComissao.upsert.mock.calls.map(
      (c: unknown[]) => (c[0] as { create: Record<string, unknown> }).create,
    );
    expect(criadas).toEqual([
      expect.objectContaining({ usuarioId: 'leo', tipo: 'SITE', percentual: 7.25 }),
      expect.objectContaining({ usuarioId: 'harada', tipo: 'SITE', percentual: 7.25 }),
    ]);
    // 50 × 7,25% = 3,625 → 3,63 (arredonda no centavo, não trunca).
    expect(Number(criadas[0].valor)).toBe(3.63);
  });

  it('venda de canal não gera linha de REP, mesmo com representante amarrado', async () => {
    prisma.pedido.findUnique.mockResolvedValue(pedido({ representanteId: 'rep-1' }));
    prisma.usuario.findMany.mockResolvedValue([]);

    await svc.recalcular('ped-1');

    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(tx.pedidoComissao.upsert).not.toHaveBeenCalled();
  });

  it('pedido do rep: base é o total LÍQUIDO de devolução', async () => {
    prisma.pedido.findUnique.mockResolvedValue(
      pedido({
        origem: 'REP_APP',
        representanteId: 'rep-1',
        total: new Prisma.Decimal('1000.00'),
        valorDevolvido: new Prisma.Decimal('200.00'),
      }),
    );
    prisma.usuario.findUnique.mockResolvedValue({ comissaoPadrao: 5 });

    await svc.recalcular('ped-1');

    const criada = (
      tx.pedidoComissao.upsert.mock.calls[0][0] as { create: Record<string, unknown> }
    ).create;
    expect(Number(criada.base)).toBe(800);
    expect(Number(criada.valor)).toBe(40);
  });

  it('pedido cancelado apaga as linhas que existiam', async () => {
    prisma.pedido.findUnique.mockResolvedValue(pedido({ status: 'CANCELADO' }));
    prisma.pedidoComissao.deleteMany.mockResolvedValue({ count: 2 });

    await svc.recalcular('ped-1');

    expect(prisma.pedidoComissao.deleteMany).toHaveBeenCalledWith({ where: { pedidoId: 'ped-1' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('falha no cálculo não propaga — comissão errada se conserta recalculando', async () => {
    prisma.pedido.findUnique.mockRejectedValue(new Error('banco fora'));
    await expect(svc.recalcular('ped-1')).resolves.toBeUndefined();
  });
});
