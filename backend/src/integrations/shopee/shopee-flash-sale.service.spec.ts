import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ShopeeFlashSaleController } from './shopee-flash-sale.controller';
import { ShopeeFlashSaleService } from './shopee-flash-sale.service';

const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'emp1' };
const MODELS = {
  response: {
    model: [
      {
        model_id: 11,
        model_name: 'Preto,G',
        price_info: [{ current_price: 39.9, original_price: 49.9 }],
        stock_info_v2: { summary_info: { total_available_stock: 7 } },
      },
      { model_id: 12, price_info: [{ current_price: 20 }] },
    ],
  },
};

function montar() {
  const shopee = {
    getShop: vi.fn().mockResolvedValue(MODELS),
    postShop: vi.fn().mockResolvedValue({ response: {} }),
  };
  return { svc: new ShopeeFlashSaleService(shopee as never), shopee };
}

describe('Oferta Relâmpago Shopee (31/10)', () => {
  it('só ADMIN e DIRECTOR passam pelo controller', () => {
    const roles = new Reflector().get<string[]>('roles', ShopeeFlashSaleController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
  });

  it('REP não mexe (403) e não chama a Shopee', async () => {
    const { svc, shopee } = montar();
    expect(() => svc.criar({ ...user, role: 'REP' } as never, 1)).toThrow(/diretor ou admin/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('modelos: preço atual e estoque de cada variação', async () => {
    const { svc, shopee } = montar();
    const r = await svc.modelos(user as never, 99);
    expect(shopee.getShop).toHaveBeenCalledWith('emp1', '/api/v2/product/get_model_list', {
      item_id: 99,
    });
    expect(r[0]).toEqual({
      model_id: 11,
      nome: 'Preto,G',
      preco_atual: 39.9,
      preco_original: 49.9,
      estoque: 7,
    });
  });

  it('adicionar: desconto vira preço sobre o preço ATUAL; preço final passa direto', async () => {
    const { svc, shopee } = montar();
    await svc.adicionarItens(user as never, 555, [
      {
        item_id: 99,
        purchase_limit: 2,
        models: [
          { model_id: 11, desconto: 20, estoque: 7 },
          { model_id: 12, preco: 15.5, estoque: 3 },
        ],
      },
    ]);
    expect(shopee.postShop).toHaveBeenCalledWith(
      'emp1',
      '/api/v2/shop_flash_sale/add_shop_flash_sale_items',
      {
        flash_sale_id: 555,
        items: [
          {
            item_id: 99,
            purchase_limit: 2,
            models: [
              { model_id: 11, input_promo_price: 31.92, stock: 7 },
              { model_id: 12, input_promo_price: 15.5, stock: 3 },
            ],
          },
        ],
      },
    );
  });

  it('desconto sem preço atual do model: recusa (nunca chuta preço)', async () => {
    const { svc, shopee } = montar();
    await expect(
      svc.adicionarItens(user as never, 555, [
        { item_id: 99, models: [{ model_id: 77, desconto: 10, estoque: 1 }] },
      ]),
    ).rejects.toThrow(/Sem preço atual/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('anúncio sem variação: item_input_promo_price e item_stock', async () => {
    const { svc, shopee } = montar();
    await svc.adicionarItens(user as never, 555, [
      { item_id: 5, models: [{ preco: 10, estoque: 4 }] },
    ]);
    expect(shopee.postShop.mock.calls[0][2]).toEqual({
      flash_sale_id: 555,
      items: [{ item_id: 5, purchase_limit: 0, item_input_promo_price: 10, item_stock: 4 }],
    });
  });

  it('editar leva o status do model; ativar chama update_shop_flash_sale', async () => {
    const { svc, shopee } = montar();
    await svc.editarItens(user as never, 555, [
      { item_id: 99, models: [{ model_id: 12, preco: 18, estoque: 2, status: 0 }] },
    ]);
    expect(shopee.postShop.mock.calls[0][1]).toBe(
      '/api/v2/shop_flash_sale/update_shop_flash_sale_items',
    );
    expect(
      (shopee.postShop.mock.calls[0][2] as { items: Array<{ models: unknown[] }> }).items[0]
        .models[0],
    ).toEqual({
      model_id: 12,
      input_promo_price: 18,
      stock: 2,
      status: 0,
    });
    await svc.status(user as never, 555, 1);
    expect(shopee.postShop).toHaveBeenLastCalledWith(
      'emp1',
      '/api/v2/shop_flash_sale/update_shop_flash_sale',
      {
        flash_sale_id: 555,
        status: 1,
      },
    );
  });
});
