import { describe, expect, it } from 'vitest';
import { pedidoDafiti, situacaoDafiti } from './dafiti-pedidos';

describe('pedido da Dafiti → pedido do app (25/10)', () => {
  it('situação pelos itens: devolução vence; cancelado só com todos cancelados', () => {
    expect(situacaoDafiti(['shipped', 'return_waiting_for_approval'])).toBe('EM_DEVOLUCAO');
    expect(situacaoDafiti(['canceled', 'canceled'])).toBe('CANCELADO');
    expect(situacaoDafiti(['canceled', 'ready_to_ship'])).toBe('A_ENVIAR');
    expect(situacaoDafiti(['shipped', 'delivered'])).toBe('ENVIADO');
    expect(situacaoDafiti(['delivered'])).toBe('ENTREGUE');
    expect(situacaoDafiti(['payment_pending'])).toBe('AGUARDANDO_PAGAMENTO');
  });

  it('itens iguais viram 1 linha com quantidade; comissão somada; líquido do repasse', () => {
    const p = pedidoDafiti({
      id: 1,
      number: 'DF123',
      createdAt: '2026-10-20T10:00:00Z',
      customer: { firstName: 'Ana', lastName: 'Silva' },
      items: [
        {
          id: 1,
          status: 'shipped',
          paidPrice: 59.9,
          paidCommission: 9,
          salesDueAmount: 50.9,
          product: { name: 'Kit 2 Bermudas', sellerSku: '3672', variation: 'M' },
          shipment: { trackingCode: 'BR1' },
        },
        {
          id: 2,
          status: 'shipped',
          paidPrice: 59.9,
          paidCommission: 9,
          salesDueAmount: 50.9,
          product: { name: 'Kit 2 Bermudas', sellerSku: '3672', variation: 'M' },
        },
        {
          id: 3,
          status: 'canceled',
          paidPrice: 30,
          paidCommission: 4,
          product: { name: 'Camiseta', sellerSku: 'X' },
        },
      ],
    });
    expect(p).toMatchObject({
      numeroExterno: 'DF123',
      comprador: 'Ana Silva',
      quantidade: 2,
      valor: 119.8,
      taxas: 18,
      liquido: 101.8,
      situacao: 'ENVIADO',
      rastreio: 'BR1',
    });
    expect(p.itens).toEqual([
      {
        sku: '3672',
        titulo: 'Kit 2 Bermudas',
        variacao: 'M',
        quantidade: 2,
        precoUnit: 59.9,
        taxa: 18,
      },
    ]);
    expect(p.extrato).toEqual([
      { rotulo: 'Venda', valor: 119.8 },
      { rotulo: 'Comissão da Dafiti', valor: -18 },
    ]);
  });

  it('sem repasse informado: líquido fica vazio (não inventa)', () => {
    const p = pedidoDafiti({
      id: 2,
      number: 'DF2',
      createdAt: '2026-10-20T10:00:00Z',
      items: [{ id: 1, status: 'pending', paidPrice: 40, product: { name: 'Bermuda' } }],
    });
    expect(p.liquido).toBeNull();
    expect(p.taxas).toBeNull();
    expect(p.extrato).toBeNull();
  });
});
