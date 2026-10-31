import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ShopeeVoucherController } from './shopee-voucher.controller';
import { type CupomDto, ShopeeVoucherService, corpoDoCupom } from './shopee-voucher.service';

const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'emp1' };
const BASE: CupomDto = {
  nome: 'Cupom 10',
  codigo: 'DEB10',
  inicio: 1793500000,
  fim: 1793600000,
  alcance: 'loja',
  tipo: 'percentual',
  percentual: 10,
  teto: 15,
  minimoCompra: 50,
  quantidade: 100,
};

function montar() {
  const shopee = {
    getShop: vi.fn().mockResolvedValue({ response: {} }),
    postShop: vi.fn().mockResolvedValue({ response: { voucher_id: 9 } }),
  };
  return { svc: new ShopeeVoucherService(shopee as never), shopee };
}

describe('Cupons Shopee (31/10)', () => {
  it('só ADMIN e DIRECTOR passam pelo controller', () => {
    const roles = new Reflector().get<string[]>('roles', ShopeeVoucherController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
  });

  it('REP não cria (403) e não chama a Shopee', () => {
    const { svc, shopee } = montar();
    expect(() => svc.criar({ ...user, role: 'REP' } as never, BASE)).toThrow(/diretor ou admin/);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('percentual da loja toda: campos da Shopee, aparece na vitrine', async () => {
    const { svc, shopee } = montar();
    await svc.criar(user as never, BASE);
    expect(shopee.postShop).toHaveBeenCalledWith('emp1', '/api/v2/voucher/add_voucher', {
      voucher_name: 'Cupom 10',
      voucher_code: 'DEB10',
      start_time: 1793500000,
      end_time: 1793600000,
      voucher_type: 1,
      reward_type: 2,
      percentage: 10,
      max_price: 15,
      min_basket_price: 50,
      usage_quantity: 100,
      display_channel_list: [1],
    });
  });

  it('valor fixo em produtos, escondido: item_id_list e sem vitrine', () => {
    const c = corpoDoCupom({
      ...BASE,
      alcance: 'produtos',
      itemIds: [11, 12],
      tipo: 'valor',
      valor: 5,
      percentual: undefined,
      teto: undefined,
      vitrine: false,
    });
    expect(c).toMatchObject({
      voucher_type: 2,
      reward_type: 1,
      discount_amount: 5,
      item_id_list: [11, 12],
    });
    expect(c.display_channel_list).toEqual([]);
    expect(c.percentage).toBeUndefined();
  });

  it('regras: produtos sem itens, percentual sem %, fim antes do início — recusa', () => {
    expect(() => corpoDoCupom({ ...BASE, alcance: 'produtos' })).toThrow(/item_ids/);
    expect(() => corpoDoCupom({ ...BASE, percentual: undefined })).toThrow(/%/);
    expect(() => corpoDoCupom({ ...BASE, fim: BASE.inicio })).toThrow(/depois do início/);
  });

  it('editar manda só o que veio; encerrar e apagar vão pras rotas certas', async () => {
    const { svc, shopee } = montar();
    await svc.editar(user as never, 9, { quantidade: 200 });
    expect(shopee.postShop).toHaveBeenLastCalledWith('emp1', '/api/v2/voucher/update_voucher', {
      voucher_id: 9,
      usage_quantity: 200,
    });
    await svc.encerrar(user as never, 9);
    expect(shopee.postShop.mock.calls[1][1]).toBe('/api/v2/voucher/end_voucher');
    await svc.apagar(user as never, 9);
    expect(shopee.postShop.mock.calls[2][1]).toBe('/api/v2/voucher/delete_voucher');
  });
});
