import { describe, expect, it, vi } from 'vitest';
import { MagaluOrdersService } from './magalu-orders.service';
import { pedidoMagalu, reais, situacaoMagalu } from './magalu-pedidos';
import { incidenteDoTicket, statusTicket, tipoTicket } from './magalu-sac';
import type { MagaluPedido } from './magalu.types';

const pedido: MagaluPedido = {
  id: 'uuid-1',
  code: '1234567890',
  status: 'approved',
  purchased_at: '2026-11-10T12:00:00+00:00',
  customer: { name: 'Maria Souza' },
  amounts: { total: 15980, normalizer: 100, commission: { total: 2397, normalizer: 100 } },
  deliveries: [
    {
      status: 'invoiced',
      shipping: { tracking_url: 'https://rastreio/1' },
      items: [
        {
          quantity: 2,
          unit_price: { value: 4990, normalizer: 100 },
          info: {
            sku: 'CAM-P-AZ',
            name: 'Camiseta',
            attributes: [{ name: 'Tamanho', value: 'P' }],
          },
        },
        {
          quantity: 1,
          unit_price: { value: 6000, normalizer: 100 },
          info: { sku: 'MOL-M', name: 'Moletom' },
        },
      ],
    },
  ],
};

describe('Magalu pedidos → MarketplaceOrder (14/11)', () => {
  it('valor com normalizador vira reais', () => {
    expect(reais({ total: 1000, normalizer: 100 })).toBe(10);
    expect(reais({ value: 4990 })).toBe(49.9);
    expect(reais(null)).toBeNull();
  });

  it('mapeia itens, total, comissão, comprador e rastreio', () => {
    const p = pedidoMagalu(pedido);
    expect(p).toMatchObject({
      numeroExterno: '1234567890',
      comprador: 'Maria Souza',
      produtoNome: 'Camiseta',
      quantidade: 3,
      valor: 159.8,
      taxas: 23.97,
      rastreio: 'https://rastreio/1',
      situacao: 'A_ENVIAR',
      status: 'approved,invoiced',
    });
    expect(p.itens).toEqual([
      {
        sku: 'CAM-P-AZ',
        titulo: 'Camiseta',
        variacao: 'Tamanho: P',
        quantidade: 2,
        precoUnit: 49.9,
        taxa: null,
      },
      { sku: 'MOL-M', titulo: 'Moletom', variacao: null, quantidade: 1, precoUnit: 60, taxa: null },
    ]);
    expect(p.pedidoEm.toISOString()).toBe('2026-11-10T12:00:00.000Z');
  });

  it('situação pelas entregas', () => {
    expect(situacaoMagalu('new', [{ status: 'new' }])).toBe('AGUARDANDO_PAGAMENTO');
    expect(situacaoMagalu('approved', [{ status: 'shipped' }])).toBe('ENVIADO');
    expect(situacaoMagalu('finished', [{ status: 'delivered' }, { status: 'cancelled' }])).toBe(
      'ENTREGUE',
    );
    expect(situacaoMagalu('cancelled', [{ status: 'cancelled' }])).toBe('CANCELADO');
    expect(situacaoMagalu('approved', [{ status: 'cancelled' }])).toBe('CANCELADO');
    expect(situacaoMagalu('finished', [{ status: 'delivered', returns: [{ status: 'x' }] }])).toBe(
      'EM_DEVOLUCAO',
    );
  });

  it('gravar: upsert idempotente por plataforma+número, não pisa pedido de outra empresa', async () => {
    const prisma = {
      marketplaceOrder: { findUnique: vi.fn(), upsert: vi.fn() },
      skuMarketplaceVinculo: { findUnique: vi.fn().mockResolvedValue(null) },
      catalogoVariacao: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const svc = new MagaluOrdersService(prisma as never, {} as never);
    prisma.marketplaceOrder.findUnique.mockResolvedValue(null);
    await svc.gravar('emp1', pedido);
    const arg = prisma.marketplaceOrder.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      plataforma_numeroExterno: { plataforma: 'MAGALU', numeroExterno: '1234567890' },
    });
    expect(arg.create).toMatchObject({ empresaId: 'emp1', plataforma: 'MAGALU', valor: 159.8 });

    prisma.marketplaceOrder.upsert.mockClear();
    prisma.marketplaceOrder.findUnique.mockResolvedValue({ empresaId: 'outra' });
    await svc.gravar('emp1', pedido);
    expect(prisma.marketplaceOrder.upsert).not.toHaveBeenCalled();
  });

  it('sincronizar pagina por _offset e para na página incompleta', async () => {
    const client = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          results: Array.from({ length: 50 }, (_, i) => ({ ...pedido, code: `P${i}` })),
        })
        .mockResolvedValueOnce({ results: [pedido] }),
    };
    const svc = new MagaluOrdersService({} as never, client as never);
    const gravar = vi.spyOn(svc, 'gravar').mockResolvedValue();
    const r = await svc.sincronizar('emp1', new Date('2026-11-12T00:00:00Z'));
    expect(r.pedidos).toBe(51);
    expect(gravar).toHaveBeenCalledTimes(51);
    expect(client.get.mock.calls[1]).toEqual([
      'emp1',
      '/seller/v1/orders',
      { updated_at__gte: '2026-11-12T00:00:00.000Z', _offset: 50, _limit: 50 },
    ]);
  });
});

describe('Magalu SAC (tickets) → incidente (14/11)', () => {
  it('tipo e status', () => {
    expect(tipoTicket({ type: 'cancellation' })).toBe('CANCELAMENTO');
    expect(tipoTicket({ type: 'exchange' })).toBe('DEVOLUCAO');
    expect(tipoTicket({ type: 'general', reason: 'defective_product' })).toBe('DEVOLUCAO');
    expect(tipoTicket({ type: 'payment', reason: 'chargeback' })).toBe('DISPUTA');
    expect(tipoTicket({ type: 'shipping', reason: 'delivery_delay' })).toBe('RECLAMACAO');
    expect(statusTicket({ status: 'waiting_seller' })).toBe('AGUARDANDO_VENDEDOR');
    expect(statusTicket({ status: 'waiting_seller_pickup' })).toBe('AGUARDANDO_VENDEDOR');
    expect(statusTicket({ status: 'waiting_customer' })).toBe('AGUARDANDO_COMPRADOR');
    expect(statusTicket({ status: 'waiting_marketplace' })).toBe('EM_MEDIACAO');
    expect(statusTicket({ status: 'waiting_seller', closed: true })).toBe('RESOLVIDO');
    expect(statusTicket({ status: 'algo_novo' })).toBe('ABERTO');
  });

  it('monta o incidente no canal MARKETPLACE_MAGALU com pedido e prazo', () => {
    const inc = incidenteDoTicket('emp1', {
      id: 't-1',
      protocol: 'PROT-9',
      type: 'shipping',
      reason: 'delivery_delay',
      status: 'waiting_seller',
      due_date: '2026-11-15T10:00:00Z',
      order: { code: '1234567890' },
    });
    expect(inc).toMatchObject({
      empresaId: 'emp1',
      canal: 'MARKETPLACE_MAGALU',
      externalId: 't-1',
      tipo: 'RECLAMACAO',
      status: 'AGUARDANDO_VENDEDOR',
      motivoCodigo: 'delivery_delay',
      pedidoExternoId: '1234567890',
    });
    expect(inc.prazoResposta?.toISOString()).toBe('2026-11-15T10:00:00.000Z');
    expect(inc.resumo).toContain('PROT-9');
    expect(inc.conversationId).toBeUndefined();
  });
});
