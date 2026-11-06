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
      sku: null,
      estoque_vendedor: null,
      estoque_full: null,
    });
  });

  it('trocarSku: manda só o SKU e pula divergente, Full e desconhecido', async () => {
    const { svc, shopee } = montar();
    const estoque = (full: number) => ({
      seller_stock: [{ stock: 0 }],
      shopee_stock: [{ stock: full }],
    });
    shopee.getShop.mockResolvedValueOnce({
      response: {
        model: [
          { model_id: 1, model_sku: 'A', stock_info_v2: estoque(0) },
          { model_id: 2, model_sku: 'X', stock_info_v2: estoque(0) },
          { model_id: 3, model_sku: 'C', stock_info_v2: estoque(5) },
          { model_id: 4, model_sku: 'D' },
        ],
      },
    });
    shopee.postShop.mockResolvedValueOnce({
      response: { success_list: [{ model_id: 1, model_sku: 'A2' }] },
    });
    const r = await svc.trocarSku(user as never, 99, [
      { model_id: 1, sku_atual: 'A', sku_novo: 'A2' },
      { model_id: 2, sku_atual: 'B', sku_novo: 'B2' },
      { model_id: 3, sku_atual: 'C', sku_novo: 'C2' },
      { model_id: 4, sku_atual: 'D', sku_novo: 'D2' },
      { model_id: 5, sku_atual: 'E', sku_novo: 'E2' },
    ]);
    expect(shopee.postShop).toHaveBeenCalledWith('emp1', '/api/v2/product/update_model', {
      item_id: 99,
      model: [{ model_id: 1, model_sku: 'A2' }],
    });
    expect(r.aceitos).toHaveLength(1);
    expect(r.pulados.map((p) => p.model_id)).toEqual([2, 3, 4, 5]);
  });

  describe('descrição', () => {
    const item = (extra: object) => ({ response: { item_list: [extra] } });

    it('normal: manda só o item e a descrição', async () => {
      const { svc, shopee } = montar();
      shopee.getShop.mockResolvedValue(item({ description_type: 'normal', description: 'velha' }));
      const r = await svc.atualizarDescricao(user as never, 99, { descricao: 'nova' });
      expect(r).toMatchObject({
        antes: { descricao: 'velha' },
        depois: { descricao: 'velha' },
        conferido: false,
      });
      expect(shopee.postShop).toHaveBeenCalledWith('emp1', '/api/v2/product/update_item', {
        item_id: 99,
        description: 'nova',
      });
    });

    it('estendida só com texto: vira um bloco de texto', async () => {
      const { svc, shopee } = montar();
      shopee.getShop.mockResolvedValue(
        item({
          description_type: 'extended',
          description_info: {
            extended_description: { field_list: [{ field_type: 'text', text: 'velha' }] },
          },
        }),
      );
      await svc.atualizarDescricao(user as never, 99, { descricao: 'nova' });
      expect(shopee.postShop.mock.calls[0][2]).toEqual({
        item_id: 99,
        description_type: 'extended',
        description_info: {
          extended_description: { field_list: [{ field_type: 'text', text: 'nova' }] },
        },
      });
    });

    it('estendida com imagem: recusa texto solto e não chama a Shopee', async () => {
      const { svc, shopee } = montar();
      shopee.getShop.mockResolvedValue(
        item({
          description_type: 'extended',
          description_info: { extended_description: { field_list: [{ field_type: 'image' }] } },
        }),
      );
      await expect(
        svc.atualizarDescricao(user as never, 99, { descricao: 'nova' }),
      ).rejects.toThrow('campos');
      expect(shopee.postShop).not.toHaveBeenCalled();
    });
  });

  it('trocarSku: sem model liberado, não chama a Shopee', async () => {
    const { svc, shopee } = montar();
    const r = await svc.trocarSku(user as never, 99, [
      { model_id: 11, sku_atual: 'nao-bate', sku_novo: 'x' },
    ]);
    expect(shopee.postShop).not.toHaveBeenCalled();
    expect(r.pulados).toHaveLength(1);
  });

  it('modelos: separa vendedor de Full e não trata lista ausente como zero', async () => {
    const { svc, shopee } = montar();
    shopee.getShop.mockResolvedValueOnce({
      response: {
        model: [
          {
            model_id: 12,
            stock_info_v2: {
              summary_info: { total_available_stock: 15 },
              seller_stock: [{ location_id: 'A', stock: 0 }],
              shopee_stock: [
                { location_id: 'B', stock: 10 },
                { location_id: 'C', stock: 5 },
              ],
            },
          },
          { model_id: 13, stock_info_v2: { seller_stock: [{ stock: 2 }] } },
        ],
      },
    });
    const r = await svc.modelos(user as never, 99);
    expect(r[0]).toMatchObject({ estoque_vendedor: 0, estoque_full: 15 });
    expect(r[1]).toMatchObject({ estoque_vendedor: 2, estoque_full: null });
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

describe('Ficha e tabela de medidas Shopee (05/11)', () => {
  const base = (campos: object) => ({ response: { item_list: [campos] } });
  const cor = {
    attribute_id: 1,
    attribute_value_list: [{ value_id: 10 }],
    original_attribute_name: 'Cor',
  };
  const tecido = { attribute_id: 2, attribute_value_list: [{ value_id: 20 }] };
  const corpoEnviado = (shopee: ReturnType<typeof montar>['shopee']) =>
    shopee.postShop.mock.calls[0][2] as Record<string, unknown>;

  it('ficha: troca o pedido, reenvia o resto e não leva mais campo nenhum', async () => {
    const { svc, shopee } = montar();
    const novo = { attribute_id: 2, attribute_value_list: [{ value_id: 21 }] };
    shopee.getShop
      .mockResolvedValueOnce(base({ attribute_list: [cor, tecido] }))
      .mockResolvedValueOnce(base({ attribute_list: [cor, novo] }));
    const r = await svc.atualizarFicha(user as never, 99, [novo]);
    expect(corpoEnviado(shopee)).toEqual({
      item_id: 99,
      attribute_list: [{ attribute_id: 1, attribute_value_list: [{ value_id: 10 }] }, novo],
    });
    expect(r.conferido).toBe(true);
    expect(r.antes).toEqual([cor, tecido]);
    expect(r.depois).toEqual([cor, novo]);
  });

  it('ficha: conferido falso se a leitura não mostrar o valor novo', async () => {
    const { svc, shopee } = montar();
    shopee.getShop.mockResolvedValue(base({ attribute_list: [cor, tecido] }));
    const r = await svc.atualizarFicha(user as never, 99, [
      { attribute_id: 2, attribute_value_list: [{ value_id: 21 }] },
    ]);
    expect(r.conferido).toBe(false);
  });

  it('ficha: atributo repetido nem chega na Shopee', async () => {
    const { svc, shopee } = montar();
    await expect(svc.atualizarFicha(user as never, 99, [tecido, tecido])).rejects.toThrow(
      /repetido/,
    );
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('tabela: imagem em anúncio com modelo zera o modelo e leva só a tabela', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ category_id: 7, size_chart_id: 55 }))
      .mockResolvedValueOnce({
        response: { size_chart_limit: { support_image_size_chart: true } },
      })
      .mockResolvedValueOnce(base({ size_chart: 'https://cf/nova.jpg' }));
    const r = await svc.atualizarTabelaMedidas(user as never, 99, { imagemId: 'abc' });
    expect(corpoEnviado(shopee)).toEqual({
      item_id: 99,
      size_chart_info: { size_chart: 'abc', size_chart_id: 0 },
    });
    expect(r).toMatchObject({
      antes: { imagem: null, modelo_id: 55 },
      depois: { imagem: 'https://cf/nova.jpg', modelo_id: null },
      conferido: true,
    });
  });

  it('tabela: categoria que não aceita imagem é recusada antes de gravar', async () => {
    const { svc, shopee } = montar();
    shopee.getShop.mockResolvedValueOnce(base({ category_id: 7 })).mockResolvedValueOnce({
      response: { size_chart_limit: { support_image_size_chart: false } },
    });
    await expect(
      svc.atualizarTabelaMedidas(user as never, 99, { imagemId: 'abc' }),
    ).rejects.toThrow(/não aceita tabela em imagem/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('tabela: modelo fechado não derruba a leitura', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ category_id: 7, size_chart_id: 55 }))
      .mockRejectedValueOnce(new Error('sem permissão'))
      .mockResolvedValueOnce({ response: {} });
    const r = await svc.tabelaMedidas(user as never, 99);
    expect(r).toMatchObject({ modelo_id: 55, modelo: null, modelo_erro: 'sem permissão' });
  });
});

describe('Preço de anúncio Shopee (01/11)', () => {
  it('manda price_list por model (sem variação = 0) e devolve aceitos e recusados', async () => {
    const { svc, shopee } = montar();
    shopee.postShop.mockResolvedValueOnce({
      response: {
        success_list: [{ model_id: 11, original_price: 59.9 }],
        failure_list: [{ model_id: 12, failed_reason: 'price too low' }],
      },
    });
    const r = await svc.atualizarPreco(user as never, 99, [
      { model_id: 11, preco: 59.9 },
      { model_id: 12, preco: 1 },
    ]);
    expect(shopee.postShop).toHaveBeenCalledWith('emp1', '/api/v2/product/update_price', {
      item_id: 99,
      price_list: [
        { model_id: 11, original_price: 59.9 },
        { model_id: 12, original_price: 1 },
      ],
    });
    expect(r.aceitos).toHaveLength(1);
    expect(r.recusados[0].failed_reason).toBe('price too low');
    await svc.atualizarPreco(user as never, 5, [{ preco: 30 }]);
    expect(shopee.postShop.mock.calls[1][2]).toEqual({
      item_id: 5,
      price_list: [{ model_id: 0, original_price: 30 }],
    });
  });

  it('REP não muda preço (403) e não chama a Shopee', async () => {
    const { svc, shopee } = montar();
    await expect(
      svc.atualizarPreco({ ...user, role: 'REP' } as never, 99, [{ preco: 10 }]),
    ).rejects.toThrow(/diretor ou admin/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });
});
