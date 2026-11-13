import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AUDIT_KEY } from '@shared/decorators/audit.decorator';
import { ShopeeApiController } from './shopee-api.controller';
import { ShopeeApiService, itensDoCorpo, zerarEstoque } from './shopee-api.service';

const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'emp1' };

function montar(full = false) {
  const shopee = {
    getShop: vi.fn().mockResolvedValue({ response: { item: [] } }),
    postShop: vi.fn().mockResolvedValue({ response: { item_id: 99 } }),
  };
  const anuncios = {
    garantirSemFull: vi.fn(async () => {
      if (full) throw new Error('Anúncio com Full ou estoque Full desconhecido: não mexi');
    }),
  };
  return { svc: new ShopeeApiService(shopee as never, anuncios as never), shopee, anuncios };
}

describe('shopee_api — passthrough com travas (13/11)', () => {
  it('controller: só ADMIN/DIRECTOR e a escrita vai pro audit log', () => {
    const roles = new Reflector().get<string[]>('roles', ShopeeApiController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
    const audit = Reflect.getMetadata(AUDIT_KEY, ShopeeApiController.prototype.escrever);
    expect(audit).toMatchObject({ resource: 'shopee_api' });
  });

  it('REP não chama a Shopee', async () => {
    const { svc, shopee } = montar();
    await expect(
      svc.ler({ ...user, role: 'REP' } as never, '/api/v2/product/get_item_list'),
    ).rejects.toThrow(/diretor ou admin/);
    expect(shopee.getShop).not.toHaveBeenCalled();
  });

  it('GET item_list passa, lista vai repetida e chave reservada cai', async () => {
    const { svc, shopee } = montar();
    const r = await svc.ler(user as never, '/api/v2/product/get_item_list', {
      offset: 0,
      page_size: 50,
      item_status: ['NORMAL', 'UNLIST'],
      access_token: 'x',
    });
    expect(r).toEqual({ response: { item: [] } });
    expect(shopee.getShop).toHaveBeenCalledWith('emp1', '/api/v2/product/get_item_list', {
      offset: 0,
      page_size: 50,
      item_status: ['NORMAL', 'UNLIST'],
    });
  });

  it('caminho fora do formato e módulos do Betinna são recusados', async () => {
    const { svc } = montar();
    await expect(svc.ler(user as never, '/api/v2/../x/y')).rejects.toThrow(/Caminho/);
    await expect(svc.ler(user as never, '/api/v2/auth/token_get')).rejects.toThrow(/Betinna/);
    await expect(
      svc.escrever(user as never, '/api/v2/push/set_app_push_config', {}),
    ).rejects.toThrow(/Betinna/);
  });

  it('update_stock é recusado e não chega na Shopee', async () => {
    const { svc, shopee } = montar();
    await expect(
      svc.escrever(user as never, '/api/v2/product/update_stock', {
        item_id: 1,
        stock_list: [{ model_id: 2, seller_stock: [{ stock: 5 }] }],
      }),
    ).rejects.toThrow(/Magis5/);
    // a rota em si é barrada, mesmo sem campo de estoque no corpo
    await expect(
      svc.escrever(user as never, '/api/v2/product/update_stock', { item_id: 1 }),
    ).rejects.toThrow(/rota de estoque/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('add_item: nasce deslistado, estoque zerado, sem repetir no timeout', async () => {
    const { svc, shopee, anuncios } = montar(true);
    const r = await svc.escrever(user as never, '/api/v2/product/add_item', {
      item_name: 'Camiseta UV',
      item_status: 'NORMAL',
      seller_stock: [{ location_id: 'BRZ', stock: 30 }],
    });
    expect(shopee.postShop).toHaveBeenCalledWith(
      'emp1',
      '/api/v2/product/add_item',
      {
        item_name: 'Camiseta UV',
        item_status: 'UNLIST',
        seller_stock: [{ location_id: 'BRZ', stock: 0 }],
      },
      {},
      { semRepetir: true },
    );
    expect(r.ajustes).toEqual(['estoque zerado (vem do Magis5)', 'item_status = UNLIST']);
    // criar não toca em anúncio existente: não consulta Full
    expect(anuncios.garantirSemFull).not.toHaveBeenCalled();
  });

  it('add_model zera o estoque de cada model', async () => {
    const { svc, shopee } = montar();
    await svc.escrever(user as never, '/api/v2/product/add_model', {
      item_id: 7,
      model_list: [{ tier_index: [0, 1], original_price: 39.9, seller_stock: [{ stock: 4 }] }],
    });
    expect(shopee.postShop.mock.calls[0][2]).toEqual({
      item_id: 7,
      model_list: [{ tier_index: [0, 1], original_price: 39.9, seller_stock: [{ stock: 0 }] }],
    });
  });

  it('escrita que não é criação com campo de estoque é recusada', async () => {
    const { svc, shopee } = montar();
    await expect(
      svc.escrever(user as never, '/api/v2/product/update_model', {
        item_id: 7,
        model: [{ model_id: 1, seller_stock: [{ stock: 2 }] }],
      }),
    ).rejects.toThrow(/estoque/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('escrita em anúncio com Full é recusada', async () => {
    const { svc, shopee, anuncios } = montar(true);
    await expect(
      svc.escrever(user as never, '/api/v2/product/update_item', { item_id: 5, item_name: 'x' }),
    ).rejects.toThrow(/Full/);
    expect(anuncios.garantirSemFull).toHaveBeenCalledWith(user, 5, { novo: false });
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('escrita em anúncio sem Full passa e devolve a resposta crua', async () => {
    const { svc } = montar(false);
    const r = await svc.escrever(user as never, '/api/v2/product/unlist_item', {
      item_list: [{ item_id: 5, unlist: true }],
    });
    expect(r).toEqual({ resposta: { response: { item_id: 99 } }, ajustes: [] });
  });

  it('rotas fbs não escrevem', async () => {
    const { svc } = montar();
    await expect(svc.escrever(user as never, '/api/v2/fbs/x_y', {})).rejects.toThrow(/Full/);
  });

  it('helpers', () => {
    expect(
      itensDoCorpo({ item_id: 1, item_id_list: [2, '3'], item_list: [{ item_id: 1 }] }),
    ).toEqual([1, 2, 3]);
    expect(zerarEstoque({ a: { normal_stock: 9 }, b: [1] })).toEqual({
      a: { normal_stock: 0 },
      b: [1],
    });
  });

  it('init_tier_variation pede a checagem de Full no modo "anúncio novo"', async () => {
    const { svc, anuncios } = montar(false);
    await svc.escrever(user as never, '/api/v2/product/init_tier_variation', {
      item_id: 8,
      tier_variation: [],
      model: [],
    });
    expect(anuncios.garantirSemFull).toHaveBeenCalledWith(user, 8, { novo: true });
  });
});
