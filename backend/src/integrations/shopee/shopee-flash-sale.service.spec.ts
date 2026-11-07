import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ShopeeFlashSaleController } from './shopee-flash-sale.controller';
import { ESPERA_RELEITURA_MS, ShopeeFlashSaleService } from './shopee-flash-sale.service';

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

  it('promoção: caminho fora da lista não chega na Shopee', async () => {
    const { svc, shopee } = montar();
    await expect(svc.promocaoEscrever(user as never, 'desconto/apagar', {})).rejects.toThrow(
      /desconhecida/,
    );
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('promoção: estoque em qualquer nível é recusado', async () => {
    const { svc, shopee } = montar();
    await expect(
      svc.promocaoEscrever(user as never, 'desconto/itens-adicionar', {
        discount_id: 1,
        item_list: [{ item_id: 2, model_list: [{ model_id: 3, model_promotion_stock: 5 }] }],
      }),
    ).rejects.toThrow(/estoque/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('promoção: escrita aceita usa o caminho da lista', async () => {
    const { svc, shopee } = montar();
    shopee.postShop.mockResolvedValue({ response: { discount_id: 9 } });
    const r = await svc.promocaoEscrever(user as never, 'desconto/encerrar', { discount_id: 9 });
    expect(shopee.postShop.mock.calls[0][1]).toBe('/api/v2/discount/end_discount');
    expect(r.resposta).toEqual({ discount_id: 9 });
  });

  describe('opção de variação', () => {
    const models = (imagem = 'img1', nome = 'Preto') => ({
      response: {
        standardise_tier_variation: [
          {
            variation_id: 1,
            variation_name: 'Cor',
            variation_option_list: [
              {
                variation_option_id: 5,
                variation_option_name: nome,
                image_id: imagem,
                image_url: 'http://x',
              },
              { variation_option_id: 0, variation_option_name: 'Azul', image_id: 'img2' },
            ],
          },
        ],
        model: [
          {
            model_id: 1,
            model_sku: 'A',
            tier_index: [0],
            stock_info_v2: { seller_stock: [], shopee_stock: [] },
          },
          {
            model_id: 2,
            model_sku: 'B',
            tier_index: [1],
            stock_info_v2: { seller_stock: [], shopee_stock: [] },
          },
        ],
      },
    });

    it('renomeia sem levar SKU, preço, estoque nem a imagem do resto mudada', async () => {
      const { svc, shopee } = montar();
      shopee.getShop
        .mockResolvedValueOnce(base({}))
        .mockResolvedValueOnce(models())
        .mockResolvedValueOnce(models())
        .mockResolvedValueOnce(models('img1', 'Preto Fosco'));
      shopee.postShop.mockResolvedValue({});
      const r = await svc.atualizarOpcao(user as never, 99, {
        nivel: 0,
        indice: 0,
        nome: 'Preto Fosco',
      });
      expect(shopee.postShop.mock.calls[0][1]).toBe('/api/v2/product/update_tier_variation');
      expect(corpoEnviado(shopee)).toEqual({
        item_id: 99,
        model_list: [
          { model_id: 1, tier_index: [0] },
          { model_id: 2, tier_index: [1] },
        ],
        standardise_tier_variation: [
          {
            variation_id: 1,
            variation_name: 'Cor',
            variation_option_list: [
              { variation_option_id: 0, variation_option_name: 'Preto Fosco', image_id: 'img1' },
              { variation_option_id: 0, variation_option_name: 'Azul', image_id: 'img2' },
            ],
          },
        ],
      });
      expect(r.conferido).toBe(true);
    });

    it('recusa Full antes de escrever', async () => {
      const { svc, shopee } = montar();
      const comFull = models();
      comFull.response.model[0].stock_info_v2 = {
        seller_stock: [],
        shopee_stock: [{ stock: 1 }] as never,
      };
      shopee.getShop.mockResolvedValueOnce(base({})).mockResolvedValueOnce(comFull);
      await expect(
        svc.atualizarOpcao(user as never, 99, { nivel: 0, indice: 0, nome: 'X' }),
      ).rejects.toThrow(/Full/);
      expect(shopee.postShop).not.toHaveBeenCalled();
    });

    it('opção que não existe não chega na Shopee', async () => {
      const { svc, shopee } = montar();
      shopee.getShop
        .mockResolvedValueOnce(base({}))
        .mockResolvedValueOnce(models())
        .mockResolvedValueOnce(models());
      await expect(
        svc.atualizarOpcao(user as never, 99, { nivel: 0, indice: 9, nome: 'X' }),
      ).rejects.toThrow(/não existe/);
      expect(shopee.postShop).not.toHaveBeenCalled();
    });
  });

  it('vídeo: null tira o vídeo do anúncio', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ video_info: [{ video_url: 'x' }] }))
      .mockResolvedValueOnce(base({ video_info: [] }));
    shopee.postShop.mockResolvedValue({});
    const r = await svc.atualizarVideo(user as never, 99, null);
    expect(corpoEnviado(shopee)).toEqual({ item_id: 99, video_upload_id: [] });
    expect(r.conferido).toBe(true);
  });

  it('imagens: manda a lista na ordem pedida', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ image: { image_id_list: ['a', 'b'] } }))
      .mockResolvedValueOnce(base({ image: { image_id_list: ['b', 'a'] } }));
    shopee.postShop.mockResolvedValue({});
    const r = await svc.atualizarImagens(user as never, 99, ['b', 'a']);
    expect(corpoEnviado(shopee)).toEqual({ item_id: 99, image: { image_id_list: ['b', 'a'] } });
    expect(r.conferido).toBe(true);
  });

  it('peso: recusa anúncio com Full antes de escrever', async () => {
    const { svc, shopee } = montar();
    shopee.getShop.mockResolvedValueOnce(base({ weight: '0.3' })).mockResolvedValueOnce({
      response: {
        model: [{ model_id: 1, stock_info_v2: { seller_stock: [], shopee_stock: [{ stock: 2 }] } }],
      },
    });
    await expect(svc.atualizarPeso(user as never, 99, { pesoKg: 0.5 })).rejects.toThrow(/Full/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('peso: estoque Full desconhecido também não passa', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ weight: '0.3' }))
      .mockResolvedValueOnce({ response: { model: [{ model_id: 1 }] } });
    await expect(svc.atualizarPeso(user as never, 99, { pesoKg: 0.5 })).rejects.toThrow(/Full/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('peso: sem Full manda só o que veio no pedido', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ weight: '0.3' }))
      .mockResolvedValueOnce({
        response: {
          model: [{ model_id: 1, stock_info_v2: { seller_stock: [], shopee_stock: [] } }],
        },
      })
      .mockResolvedValueOnce(base({ weight: '0.5' }));
    shopee.postShop.mockResolvedValue({});
    const r = await svc.atualizarPeso(user as never, 99, { pesoKg: 0.5 });
    expect(corpoEnviado(shopee)).toEqual({ item_id: 99, weight: 0.5 });
    expect(r.conferido).toBe(true);
  });

  it('logística: reenvia o canal não citado igual', async () => {
    const { svc, shopee } = montar();
    const canal = (id: number, ligado: boolean) => ({
      logistic_id: id,
      enabled: ligado,
      is_free: false,
    });
    shopee.getShop
      .mockResolvedValueOnce(base({ logistic_info: [canal(1, true), canal(2, true)] }))
      .mockResolvedValueOnce(base({ logistic_info: [canal(1, true), canal(2, false)] }));
    shopee.postShop.mockResolvedValue({});
    const r = await svc.atualizarLogistica(user as never, 99, [{ logistic_id: 2, enabled: false }]);
    expect(corpoEnviado(shopee)).toEqual({
      item_id: 99,
      logistic_info: [canal(1, true), canal(2, false)],
    });
    expect(r.conferido).toBe(true);
  });

  it('status: deslistar usa unlist_item e confere a leitura', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ item_status: 'NORMAL' }))
      .mockResolvedValueOnce({
        response: {
          model: [{ model_id: 1, stock_info_v2: { seller_stock: [], shopee_stock: [] } }],
        },
      })
      .mockResolvedValueOnce(base({ item_status: 'UNLIST' }));
    shopee.postShop.mockResolvedValue({ response: { failure_list: [] } });
    const r = await svc.atualizarStatus(user as never, 99, false);
    expect(shopee.postShop.mock.calls[0][1]).toBe('/api/v2/product/unlist_item');
    expect(corpoEnviado(shopee)).toEqual({ item_list: [{ item_id: 99, unlist: true }] });
    expect(r).toMatchObject({ antes: 'NORMAL', depois: 'UNLIST', conferido: true });
  });

  it('status: falha da Shopee vira erro', async () => {
    const { svc, shopee } = montar();
    shopee.getShop.mockResolvedValueOnce(base({ item_status: 'NORMAL' })).mockResolvedValueOnce({
      response: {
        model: [{ model_id: 1, stock_info_v2: { seller_stock: [], shopee_stock: [] } }],
      },
    });
    shopee.postShop.mockResolvedValue({
      response: { failure_list: [{ failed_reason: 'em promoção' }] },
    });
    await expect(svc.atualizarStatus(user as never, 99, false)).rejects.toThrow(/em promoção/);
  });

  it('ficha: remover reenvia o resto e sem o atributo pedido', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ attribute_list: [cor, tecido] }))
      .mockResolvedValueOnce(base({ attribute_list: [tecido] }));
    shopee.postShop.mockResolvedValue({});
    const r = await svc.removerAtributos(user as never, 99, [1]);
    expect(corpoEnviado(shopee)).toEqual({ item_id: 99, attribute_list: [tecido] });
    expect(r.conferido).toBe(true);
  });

  it('ficha: remover atributo que não está na ficha nem chega na Shopee', async () => {
    const { svc, shopee } = montar();
    shopee.getShop.mockResolvedValueOnce(base({ attribute_list: [cor] }));
    await expect(svc.removerAtributos(user as never, 99, [7])).rejects.toThrow(/fora da ficha/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('título: manda só o item_name e confere pela leitura', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ item_name: 'velho' }))
      .mockResolvedValueOnce(base({ item_name: 'novo' }));
    shopee.postShop.mockResolvedValue({ warning: '' });
    const r = await svc.atualizarTitulo(user as never, 99, 'novo');
    expect(corpoEnviado(shopee)).toEqual({ item_id: 99, item_name: 'novo' });
    expect(r).toMatchObject({
      antes: { titulo: 'velho' },
      depois: { titulo: 'novo' },
      conferido: true,
    });
  });

  it('título: conferido falso se a leitura não mostrar o novo', async () => {
    const { svc, shopee } = montar();
    shopee.getShop.mockResolvedValue(base({ item_name: 'velho' }));
    shopee.postShop.mockResolvedValue({});
    const r = await svc.atualizarTitulo(user as never, 99, 'novo');
    expect(r.conferido).toBe(false);
  });

  it('marca: manda só a marca e confere pela leitura', async () => {
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ brand: { brand_id: 0, original_brand_name: 'NoBrand' } }))
      .mockResolvedValueOnce(base({ brand: { brand_id: 7, original_brand_name: 'Ribelt' } }));
    shopee.postShop.mockResolvedValue({ warning: '' });
    const r = await svc.atualizarMarca(user as never, 99, {
      brand_id: 7,
      original_brand_name: 'Ribelt',
    });
    expect(corpoEnviado(shopee)).toEqual({
      item_id: 99,
      brand: { brand_id: 7, original_brand_name: 'Ribelt' },
    });
    expect(r).toMatchObject({ antes: { brand_id: 0 }, depois: { brand_id: 7 }, conferido: true });
  });

  it('marca: conferido falso se a leitura não mostrar a marca nova', async () => {
    const { svc, shopee } = montar();
    shopee.getShop.mockResolvedValue(base({ brand: { brand_id: 0 } }));
    shopee.postShop.mockResolvedValue({});
    const r = await svc.atualizarMarca(user as never, 99, { brand_id: 7 });
    expect(r.conferido).toBe(false);
  });

  it('marcas: pede a categoria e devolve a próxima página', async () => {
    const { svc, shopee } = montar();
    shopee.getShop.mockResolvedValue({
      response: {
        brand_list: [{ brand_id: 7, original_brand_name: 'Ribelt' }],
        has_next_page: true,
        next_offset: 100,
        is_mandatory: false,
      },
    });
    const r = await svc.marcasDaCategoria(user as never, 5, {});
    expect(shopee.getShop.mock.calls[0][2]).toEqual({
      category_id: 5,
      offset: 0,
      page_size: 100,
      status: 1,
      language: 'pt-BR',
    });
    expect(r).toMatchObject({ proxima: 100, obrigatoria: false });
  });

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

  it('ficha: valor livre diferente não passa como conferido', async () => {
    const { svc, shopee } = montar();
    const livre = (nome: string) => ({
      attribute_id: 3,
      attribute_value_list: [{ value_id: 0, original_value_name: nome }],
    });
    shopee.getShop.mockResolvedValue(base({ attribute_list: [livre('Elastano')] }));
    const r = await svc.atualizarFicha(user as never, 99, [livre('Algodão')]);
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

  it('tabela: leitura atrasada da Shopee não vira falso negativo', async () => {
    ESPERA_RELEITURA_MS.valor = 0;
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ category_id: 7, size_chart: 'https://cf/velha.jpg' }))
      .mockResolvedValueOnce({
        response: { size_chart_limit: { support_image_size_chart: true } },
      })
      .mockResolvedValueOnce(base({ size_chart: 'https://cf/velha.jpg' }))
      .mockResolvedValueOnce(base({ size_chart: 'https://cf/nova.jpg' }));
    shopee.postShop.mockResolvedValue({ warning: 'The gtin is a mandatory field' });
    const r = await svc.atualizarTabelaMedidas(user as never, 99, { imagemId: 'abc' });
    expect(r).toMatchObject({
      depois: { imagem: 'https://cf/nova.jpg' },
      conferido: true,
      aviso: 'The gtin is a mandatory field',
    });
    ESPERA_RELEITURA_MS.valor = 2000;
  });

  it('tabela: se nunca mudar, para depois das releituras e diz que não conferiu', async () => {
    ESPERA_RELEITURA_MS.valor = 0;
    const { svc, shopee } = montar();
    shopee.getShop
      .mockResolvedValueOnce(base({ category_id: 7, size_chart: 'https://cf/velha.jpg' }))
      .mockResolvedValueOnce({
        response: { size_chart_limit: { support_image_size_chart: true } },
      })
      .mockResolvedValue(base({ size_chart: 'https://cf/velha.jpg' }));
    shopee.postShop.mockResolvedValue({});
    const r = await svc.atualizarTabelaMedidas(user as never, 99, { imagemId: 'abc' });
    expect(r.conferido).toBe(false);
    expect(shopee.getShop).toHaveBeenCalledTimes(6);
    ESPERA_RELEITURA_MS.valor = 2000;
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
