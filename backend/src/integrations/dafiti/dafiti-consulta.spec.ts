import { describe, expect, it, vi } from 'vitest';
import { DafitiConsultaController } from './dafiti-consulta.controller';

/** Consulta de leitura da Dafiti com a chave do app (#01, 02/11). */
describe('DafitiConsultaController', () => {
  const user = { empresaIdAtiva: 'emp1' } as never;

  it('todas=1 junta as páginas do estoque do galpão até a última', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ products: [{ sellerSku: 'A' }], page: { totalPages: 2 } })
      .mockResolvedValueOnce({ products: [{ sellerSku: 'B' }], page: { totalPages: 2 } });
    const c = new DafitiConsultaController({ get } as never);
    const r = await c.consultar(user, {
      caminho: '/v2/fulfillment-products/stock-on-hand',
      page: 0,
      size: 50,
      todas: '1',
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1]).toEqual([
      'emp1',
      '/v2/fulfillment-products/stock-on-hand',
      { page: 1, size: 100 },
    ]);
    expect(r).toEqual({ total: 2, products: [{ sellerSku: 'A' }, { sellerSku: 'B' }] });
  });

  it('sem todas: uma página, com a chave da empresa ativa', async () => {
    const get = vi.fn().mockResolvedValue({ purchaseOrders: [] });
    const c = new DafitiConsultaController({ get } as never);
    await c.consultar(user, { caminho: '/v2/purchase-orders', page: 3, size: 10 });
    expect(get).toHaveBeenCalledWith('emp1', '/v2/purchase-orders', { page: 3, size: 10 });
  });
});
