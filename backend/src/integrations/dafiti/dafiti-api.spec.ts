import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AUDIT_KEY } from '@shared/decorators/audit.decorator';
import { forcarInativo, recusaEscrita, recusaQuery } from './dafiti-api';
import { DafitiApiController } from './dafiti-api.controller';

const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'e1' };

function montar() {
  const dafiti = {
    get: vi.fn().mockResolvedValue({ items: [] }),
    enviar: vi.fn().mockResolvedValue({ id: 99 }),
  };
  return { ctrl: new DafitiApiController(dafiti as never), dafiti };
}

describe('dafiti_api — passthrough com travas (13/11)', () => {
  it('só ADMIN/DIRECTOR e a escrita vai pro audit log', () => {
    const roles = new Reflector().get<string[]>('roles', DafitiApiController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
    expect(Reflect.getMetadata(AUDIT_KEY, DafitiApiController.prototype.escrever)).toMatchObject({
      resource: 'dafiti_api',
    });
  });

  it('ler: GET em qualquer /v2, lista vira parâmetro repetido', async () => {
    const { ctrl, dafiti } = montar();
    await ctrl.ler(user as never, { caminho: '/v2/categories', query: { ids: [1, 2], limit: 10 } });
    expect(dafiti.get).toHaveBeenCalledWith('e1', '/v2/categories', { ids: ['1', '2'], limit: 10 });
  });

  it('estoque e Full não passam, nem no caminho nem no corpo', () => {
    expect(recusaEscrita('PUT', '/v2/products/1/stock', {})).toMatch(/Magis5/);
    expect(recusaEscrita('POST', '/v2/fulfillment-products/x', {})).toMatch(/anúncio|Full/);
    expect(recusaEscrita('PUT', '/v2/products/1', { quantity: 5 })).toMatch(/estoque/);
    expect(
      recusaEscrita('POST', '/v2/product-set/1/products', [{ variation: 'P', stock: { qty: 0 } }]),
    ).toMatch(/estoque/);
  });

  it('escrita fora de anúncio é recusada', () => {
    expect(recusaEscrita('POST', '/v2/orders/1/cancel', {})).toMatch(/anúncio/);
    expect(recusaEscrita('PUT', '/v2/../orders', {})).toMatch(/Caminho/);
  });

  it('apagar só foto; anúncio e variação se desativam', () => {
    expect(recusaEscrita('DELETE', '/v2/product-set/1', undefined)).toMatch(/desativam/);
    expect(recusaEscrita('DELETE', '/v2/product-set/1/images/5', undefined)).toBeNull();
  });

  it('criação de anúncio e de variação nasce inativa', () => {
    expect(forcarInativo('POST', '/v2/product-set', { name: 'x', status: 'active' }).corpo).toEqual(
      {
        name: 'x',
        status: 'inactive',
        shipmentTypeId: 2,
      },
    );
    expect(
      forcarInativo('POST', '/v2/product-set/7/products', [{ variation: 'P' }, { variation: 'M' }])
        .corpo,
    ).toEqual([
      { variation: 'P', status: 'inactive', shipmentTypeId: 2 },
      { variation: 'M', status: 'inactive', shipmentTypeId: 2 },
    ]);
    expect(forcarInativo('PUT', '/v2/product-set/7', { status: 'active' }).ajustes).toEqual([]);
  });

  it('rota escrever: recusa sem chamar a Dafiti; criação vai inativa e devolve ajustes', async () => {
    const { ctrl, dafiti } = montar();
    await expect(
      ctrl.escrever(user as never, { metodo: 'PUT', caminho: '/v2/products/1/stock', corpo: {} }),
    ).rejects.toThrow(/Magis5/);
    expect(dafiti.enviar).not.toHaveBeenCalled();

    const r = await ctrl.escrever(user as never, {
      metodo: 'POST',
      caminho: '/v2/product-set',
      corpo: { name: 'Kit' },
    });
    expect(dafiti.enviar).toHaveBeenCalledWith('e1', 'POST', '/v2/product-set', {
      name: 'Kit',
      status: 'inactive',
      shipmentTypeId: 2,
    });
    expect(r.ajustes).toEqual([
      'status = inactive (nasce desativado)',
      'shipmentTypeId = 2 (fora do Full)',
    ]);
  });

  it('Full: shipmentTypeId 1 é recusado; ativar vai na URL só com status válido', async () => {
    expect(recusaEscrita('POST', '/v2/product-set/7/products', { shipmentTypeId: 1 })).toMatch(
      /Full/,
    );
    expect(recusaQuery({ status: 'active' })).toBeNull();
    expect(recusaQuery({ status: 'x' })).toMatch(/inválido/);
    expect(recusaQuery({ outro: '1' })).toMatch(/não passa/);
    const { ctrl, dafiti } = montar();
    await ctrl.escrever(user as never, {
      metodo: 'PUT',
      caminho: '/v2/product-set/7/products/9/status',
      query: { status: 'inactive' },
    });
    expect(dafiti.enviar).toHaveBeenCalledWith(
      'e1',
      'PUT',
      '/v2/product-set/7/products/9/status?status=inactive',
      undefined,
    );
  });
});
