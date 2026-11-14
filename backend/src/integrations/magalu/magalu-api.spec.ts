import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AUDIT_KEY } from '@shared/decorators/audit.decorator';
import { caminhoValido, forcarInativo, recusaEscrita, temEstoque } from './magalu-api';
import { MagaluApiController } from './magalu-api.controller';
import { hostDoCaminho, montarQuery } from './magalu-client.service';

const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'emp1' };

function montar() {
  const client = {
    get: vi.fn().mockResolvedValue({ results: [] }),
    enviar: vi.fn().mockResolvedValue({ ok: true }),
  };
  return { ctrl: new MagaluApiController(client as never), client };
}

describe('magalu_api — travas (14/11)', () => {
  it('controller: só ADMIN/DIRECTOR, rota /marketplace e a escrita vai pro audit log', () => {
    const roles = new Reflector().get<string[]>('roles', MagaluApiController);
    expect([...roles].sort()).toEqual(['ADMIN', 'DIRECTOR']);
    expect(Reflect.getMetadata('path', MagaluApiController)).toBe('marketplace/magalu/api');
    const audit = Reflect.getMetadata(AUDIT_KEY, MagaluApiController.prototype.escrever);
    expect(audit).toMatchObject({ resource: 'magalu_api' });
  });

  it('REP não chama o Magalu', () => {
    const { ctrl, client } = montar();
    expect(() =>
      ctrl.ler({ ...user, role: 'REP' } as never, { caminho: '/seller/v1/orders' }),
    ).toThrow(/diretor ou admin/);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('GET é livre em pedido, SAC, anúncio e perguntas', async () => {
    const { ctrl, client } = montar();
    await ctrl.ler(user as never, { caminho: '/seller/v1/orders', query: { _limit: 10 } });
    expect(client.get).toHaveBeenCalledWith('emp1', '/seller/v1/orders', { _limit: 10 });
    for (const c of [
      '/seller/v0/tickets',
      '/seller/v1/portfolios/stocks/SKU-1',
      '/v0/questions',
      '/v0/conversations/abc/messages',
    ]) {
      expect(caminhoValido(c)).toBe(true);
    }
  });

  it('caminho fora do mapa ou com .. é recusado', () => {
    expect(caminhoValido('/seller/v1/../../x')).toBe(false);
    expect(caminhoValido('/v1/qualquer')).toBe(false);
    expect(caminhoValido('https://evil.com/seller/v1/orders')).toBe(false);
    expect(caminhoValido('/seller/v1/orders?x=1')).toBe(false);
  });

  it('host: perguntas e chat em services.magalu.com; o resto em api.magalu.com', () => {
    expect(hostDoCaminho('/v0/questions')).toBe('https://services.magalu.com');
    expect(hostDoCaminho('/v0/conversations/1')).toBe('https://services.magalu.com');
    expect(hostDoCaminho('/seller/v1/orders')).toBe('https://api.magalu.com');
    expect(montarQuery({ status: ['new', 'approved'], _limit: 5 })).toBe(
      '?status=new&status=approved&_limit=5',
    );
  });

  it('estoque NUNCA escreve: nem pela rota, nem pelo corpo', () => {
    expect(recusaEscrita('POST', '/seller/v1/portfolios/stocks/SKU-1', {})).toMatch(/Magis5/);
    expect(recusaEscrita('PATCH', '/seller/v1/portfolios/stocks/SKU-1', {})).toMatch(/Magis5/);
    expect(recusaEscrita('PATCH', '/seller/v1/portfolios/skus/SKU-1', { stock: 5 })).toMatch(
      /estoque/,
    );
    expect(
      recusaEscrita('POST', '/seller/v1/portfolios/skus', { extra: [{ quantity: 3 }] }),
    ).toMatch(/estoque/);
    expect(temEstoque({ a: { b: [{ warehouse_id: 1 }] } })).toBe(true);
  });

  it('escrita só em SKU e preço; pedido, SAC, pergunta e DELETE ficam fora', () => {
    expect(recusaEscrita('POST', '/seller/v1/portfolios/skus', { sku: 'A' })).toBeNull();
    expect(recusaEscrita('PATCH', '/seller/v1/portfolios/skus/A', { title: 'x' })).toBeNull();
    expect(recusaEscrita('PUT', '/seller/v1/portfolios/skus/A', { title: 'x' })).toBeNull();
    expect(recusaEscrita('POST', '/seller/v1/portfolios/prices/A', { price: 1000 })).toBeNull();
    expect(recusaEscrita('PATCH', '/seller/v1/portfolios/prices/A', { price: 1000 })).toBeNull();
    expect(recusaEscrita('PUT', '/seller/v1/portfolios/skus', {})).toMatch(/Escrita só em anúncio/);
    expect(recusaEscrita('POST', '/seller/v1/deliveries/1/invoices', {})).toMatch(/anúncio/);
    expect(recusaEscrita('POST', '/seller/v0/tickets/1/messages', {})).toMatch(/anúncio/);
    expect(recusaEscrita('POST', '/v0/questions/1/answer', {})).toMatch(/anúncio/);
    expect(recusaEscrita('DELETE', '/seller/v1/portfolios/skus/A', undefined)).toMatch(/Apagar/);
  });

  it('Full (fulfillment: true) é recusado; false passa', () => {
    expect(recusaEscrita('PATCH', '/seller/v1/portfolios/skus/A', { fulfillment: true })).toMatch(
      /Full/,
    );
    expect(
      recusaEscrita('PATCH', '/seller/v1/portfolios/skus/A', { fulfillment: false }),
    ).toBeNull();
  });

  it('SKU novo nasce active=false; alteração e preço não mudam o corpo', () => {
    const r = forcarInativo('POST', '/seller/v1/portfolios/skus', { sku: 'A', active: true });
    expect(r.corpo).toEqual({ sku: 'A', active: false });
    expect(r.ajustes).toEqual(['active = false (SKU nasce desativado)']);
    const p = forcarInativo('PATCH', '/seller/v1/portfolios/skus/A', { active: true });
    expect(p).toEqual({ corpo: { active: true }, ajustes: [] });
  });

  it('controller: escrita recusada não chega no Magalu; criação vai com active=false', async () => {
    const { ctrl, client } = montar();
    await expect(
      ctrl.escrever(user as never, {
        metodo: 'PATCH',
        caminho: '/seller/v1/portfolios/stocks/A',
        corpo: { quantity: 1 },
      }),
    ).rejects.toThrow(/Magis5/);
    expect(client.enviar).not.toHaveBeenCalled();

    const r = await ctrl.escrever(user as never, {
      metodo: 'POST',
      caminho: '/seller/v1/portfolios/skus',
      corpo: { sku: 'NOVO', title: 'Camiseta', active: true },
    });
    expect(client.enviar).toHaveBeenCalledWith('emp1', 'POST', '/seller/v1/portfolios/skus', {
      sku: 'NOVO',
      title: 'Camiseta',
      active: false,
    });
    expect(r.ajustes).toHaveLength(1);
  });
});
