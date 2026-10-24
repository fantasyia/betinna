import { describe, expect, it, vi } from 'vitest';
import { custoDosItens, financeiroMl, financeiroShopee, lucroDoPedido } from './financeiro';

describe('financeiro do pedido de marketplace (24/10)', () => {
  it('ML: comissão por item × quantidade, frete da loja e líquido', () => {
    const f = financeiroMl(
      {
        total_amount: 120,
        order_items: [
          {
            item: {
              title: 'Bermuda',
              seller_sku: ' BER-PT-M ',
              variation_attributes: [{ name: 'Cor', value_name: 'Preto' }],
            },
            quantity: 2,
            unit_price: 60,
            sale_fee: 9.6,
          },
        ],
      },
      12.5,
    );
    expect(f.itens[0]).toMatchObject({ sku: 'BER-PT-M', variacao: 'Cor: Preto', taxa: 19.2 });
    expect(f).toMatchObject({ taxas: 19.2, frete: 12.5, liquido: 88.3 });
  });

  it('Shopee: líquido vem do extrato; sem extrato, só os itens', () => {
    const order = {
      item_list: [
        {
          item_name: 'Kit 2 Bermudas',
          model_sku: 'KIT2-PT',
          model_name: 'Preto,M',
          model_quantity_purchased: 1,
          model_discounted_price: 49.9,
        },
      ],
    };
    const f = financeiroShopee(order, {
      escrow_amount: 38.4,
      commission_fee: 7,
      service_fee: 3,
      seller_transaction_fee: 1.5,
      actual_shipping_fee: 20,
      shopee_shipping_rebate: 20,
    });
    expect(f).toMatchObject({ taxas: 11.5, frete: 0, liquido: 38.4 });
    expect(financeiroShopee(order, null)).toMatchObject({
      liquido: null,
      taxas: null,
      extrato: null,
    });
  });

  it('Shopee: taxa pelo valor líquido, cupom da loja e ajuste fecham no escrow (pedido real)', () => {
    const f = financeiroShopee(
      {
        item_list: [
          {
            item_name: 'Kit 2 Bermudas',
            model_sku: '2BL M04',
            model_quantity_purchased: 1,
            model_discounted_price: 69.99,
          },
        ],
      },
      {
        escrow_amount: 37.01,
        order_selling_price: 69.99,
        voucher_from_seller: 17.5,
        commission_fee: 9.76,
        net_commission_fee: 7.97,
        service_fee: 5.23,
        net_service_fee: 4.4,
        shipping_seller_protection_fee_amount: 0.49,
        actual_shipping_fee: 26.3,
        shopee_shipping_rebate: 20,
        buyer_paid_shipping_fee: 6.3,
      },
    );
    expect(f).toMatchObject({ taxas: 12.86, frete: 0, liquido: 37.01 });
    expect(f.extrato).toEqual([
      { rotulo: 'Produtos', valor: 69.99 },
      { rotulo: 'Cupom da loja', valor: -17.5 },
      { rotulo: 'Comissão da Shopee', valor: -7.97 },
      { rotulo: 'Taxa de serviço', valor: -4.4 },
      { rotulo: 'Proteção de envio', valor: -0.49 },
      { rotulo: 'Outros ajustes da Shopee', valor: -2.62 },
    ]);
    const soma = Math.round(f.extrato!.reduce((s, l) => s + l.valor, 0) * 100) / 100;
    expect(soma).toBe(37.01);
  });

  it('custo: vínculo de kit (2 × a variação) e SKU do cadastro; item sem custo marca incompleto', async () => {
    const prisma = {
      skuMarketplaceVinculo: {
        findUnique: vi.fn(async ({ where }) =>
          where.empresaId_plataforma_sku.sku === 'KIT2-PT'
            ? { variacaoId: 'v1', quantidade: 2 }
            : null,
        ),
      },
      catalogoVariacao: {
        findFirst: vi.fn(async ({ where }) =>
          where.id === 'v1' || where.OR?.[0]?.sku === 'BER-PT-M'
            ? { modeloLinha: { custoPorPeca: '9.50' } }
            : null,
        ),
      },
    };
    const r = await custoDosItens(prisma as never, 'e1', 'SHOPEE', [
      { sku: 'KIT2-PT', titulo: 'Kit', variacao: null, quantidade: 1, precoUnit: 49.9 },
      { sku: 'BER-PT-M', titulo: 'Bermuda', variacao: null, quantidade: 3, precoUnit: 25 },
    ]);
    expect(r).toMatchObject({ custo: 47.5, completo: true });
    expect(r.itens.map((i) => i.custoUnit)).toEqual([19, 9.5]);

    const sem = await custoDosItens(prisma as never, 'e1', 'SHOPEE', [
      { sku: 'XYZ', titulo: '?', variacao: null, quantidade: 1, precoUnit: 10 },
    ]);
    expect(sem.completo).toBe(false);
  });

  it('lucro só com líquido e custo completo', () => {
    expect(lucroDoPedido({ valor: 120, liquido: 88.3, custo: 19, custoCompleto: true })).toEqual({
      lucro: 69.3,
      margemPct: 57.8,
    });
    expect(
      lucroDoPedido({ valor: 120, liquido: 88.3, custo: 19, custoCompleto: false }).lucro,
    ).toBeNull();
  });
});
