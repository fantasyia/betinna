import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PedidoComissoesService } from './pedido-comissoes.service';

const makePrisma = () => ({
  pedido: { findUnique: vi.fn() },
  usuario: { findUnique: vi.fn(), findMany: vi.fn(async () => [] as unknown[]) },
  pedidoComissao: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    updateMany: vi.fn(async () => ({ count: 0 })),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
});
let tx: {
  pedidoComissao: {
    deleteMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
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
    modalidade: 'VENDA',
    ...over,
  });

  beforeEach(() => {
    tx = {
      pedidoComissao: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        updateMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(),
      },
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

  it('frete fica FORA da base — é repasse pra transportadora, não venda', async () => {
    // Total do ERP inclui o frete cotado lá: R$50 de produto + R$10,11 de frete.
    prisma.pedido.findUnique.mockResolvedValue(
      pedido({ total: new Prisma.Decimal('60.11'), frete: new Prisma.Decimal('10.11') }),
    );
    prisma.usuario.findMany.mockResolvedValue([{ id: 'harada', comissaoSite: 7.25 }]);

    await svc.recalcular('ped-1');

    const criada = (
      tx.pedidoComissao.upsert.mock.calls[0][0] as { create: Record<string, unknown> }
    ).create;
    expect(Number(criada.base)).toBe(50);
    expect(Number(criada.valor)).toBe(3.63);
  });

  it('pedido cancelado apaga as linhas que existiam', async () => {
    prisma.pedido.findUnique.mockResolvedValue(pedido({ status: 'CANCELADO' }));
    prisma.pedidoComissao.deleteMany.mockResolvedValue({ count: 2 });

    await svc.recalcular('ped-1');

    // Só some quem NÃO tem conta no ERP; quem tem, zera (vira aviso na varredura).
    expect(prisma.pedidoComissao.deleteMany).toHaveBeenCalledWith({
      where: { pedidoId: 'ped-1', contaPagarErpId: null },
    });
    expect(prisma.pedidoComissao.updateMany).toHaveBeenCalledWith({
      where: { pedidoId: 'ped-1', contaPagarErpId: { not: null } },
      data: { valor: new Prisma.Decimal(0) },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('falha no cálculo não propaga — comissão errada se conserta recalculando', async () => {
    prisma.pedido.findUnique.mockRejectedValue(new Error('banco fora'));
    await expect(svc.recalcular('ped-1')).resolves.toBeUndefined();
  });
});

/**
 * Locação comissiona por MÊS (decisão do Léo, 05/09) — o pedido de locação não
 * pode pagar a % cheia sobre o total na instalação. Num contrato de 36 meses,
 * isso transformava o valor de UM mês no de trinta e seis.
 */
describe('PedidoComissoesService — locação não comissiona como venda', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: PedidoComissoesService;

  beforeEach(() => {
    tx = {
      pedidoComissao: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        updateMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(),
      },
    };
    prisma = makePrisma();
    svc = new PedidoComissoesService(prisma as never);
  });

  const locacao = (over: Record<string, unknown> = {}) => ({
    id: 'ped-loc',
    empresaId: 'emp-1',
    origem: 'REP_APP',
    status: 'AGUARDANDO_LIBERACAO',
    total: new Prisma.Decimal('4350.00'),
    frete: null,
    valorDevolvido: null,
    representanteId: 'rep-1',
    modalidade: 'LOCACAO',
    ...over,
  });

  it('NÃO cria linha de comissão pra pedido de locação, mesmo com rep e % configurados', async () => {
    prisma.pedido.findUnique.mockResolvedValue(locacao());
    prisma.usuario.findUnique.mockResolvedValue({ comissaoPadrao: 10 });

    await svc.recalcular('ped-loc');

    expect(tx.pedidoComissao.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('limpa linha de venda que já existia num pedido de locação (sem conta no ERP)', async () => {
    prisma.pedido.findUnique.mockResolvedValue(locacao());
    prisma.pedidoComissao.deleteMany.mockResolvedValue({ count: 1 });

    await svc.recalcular('ped-loc');

    expect(prisma.pedidoComissao.deleteMany).toHaveBeenCalledWith({
      where: { pedidoId: 'ped-loc', contaPagarErpId: null },
    });
  });

  it('venda segue comissionando normalmente (a mudança não vaza pro caminho antigo)', async () => {
    prisma.pedido.findUnique.mockResolvedValue({
      ...locacao(),
      modalidade: 'VENDA',
      origem: 'REP_APP',
    });
    prisma.usuario.findUnique.mockResolvedValue({ comissaoPadrao: 10 });

    await svc.recalcular('ped-loc');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.pedidoComissao.upsert).toHaveBeenCalled();
  });
});
