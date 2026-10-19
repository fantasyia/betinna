import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GoogleTagService, corpoCompraGa4 } from './google-tag.service';

/** Compra paga pro GA4 pelo servidor — Measurement Protocol (Léo, 15/10). */

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const CONFIG = {
  googleTag: { ativo: true, ga4Id: 'G-8XEB9JV0KH', adsId: null, compraLabel: null },
};

function montar(
  o: { secret?: string | null; trava?: number; pedido?: Record<string, unknown> } = {},
) {
  const prisma = {
    pedido: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'ped-9',
        empresaId: 'emp-1',
        origem: 'VITRINE',
        numero: 'PED-0009',
        total: 867.99,
        contatoEmail: 'ana@loja.com',
        contatoTelefone: '5511999990000',
        atribuicao: { google: { clientId: '123.456' } },
        itens: [{ produtoId: 'p1', quantidade: 43, precoUnitario: 20.19 }],
        empresa: { config: CONFIG },
        ...o.pedido,
      }),
    },
    $executeRaw: vi.fn().mockResolvedValue(o.trava ?? 1),
  };
  const integracoes = {
    obterCredenciaisInternas: vi.fn(async () => {
      if (o.secret === null) throw new Error('sem conexão');
      return { credenciais: { apiSecret: o.secret ?? 'segredo-teste' } };
    }),
  };
  const svc = new GoogleTagService(prisma as never, integracoes as never);
  const http = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  (svc as unknown as { http: typeof http }).http = http;
  return { svc, prisma, http };
}

describe('corpoCompraGa4', () => {
  it('purchase com o mesmo transaction_id do navegador, client_id do _ga e e-mail/telefone em hash', () => {
    const c = corpoCompraGa4({
      pedidoId: 'ped-9',
      total: 867.99,
      clientId: '123.456',
      email: ' Ana@Loja.com ',
      telefone: '(11) 99999-0000',
      itens: [{ produtoId: 'p1', quantidade: 2, preco: 10 }],
    });
    expect(c.client_id).toBe('123.456');
    expect(c.user_data).toEqual({
      sha256_email_address: [sha('ana@loja.com')],
      sha256_phone_number: [sha('+5511999990000')],
    });
    expect(c.events[0]).toMatchObject({
      name: 'purchase',
      params: { transaction_id: 'ped-9', value: 867.99, currency: 'BRL' },
    });
  });

  it('sem o cookie _ga: client_id estável do pedido (dígitos.dígitos)', () => {
    const a = corpoCompraGa4({ pedidoId: 'ped-9', total: 1, itens: [] });
    const b = corpoCompraGa4({ pedidoId: 'ped-9', total: 1, itens: [] });
    expect(a.client_id).toMatch(/^\d+\.\d+$/);
    expect(a.client_id).toBe(b.client_id);
    expect(a.user_data).toBeUndefined();
  });
});

describe('GoogleTagService.enviarCompra', () => {
  it('manda pro /mp/collect do G- com o secret e marca o pedido', async () => {
    const { svc, http, prisma } = montar();
    await svc.enviarCompra('ped-9');
    const [url, init] = http.mock.calls[0];
    expect(url).toBe(
      'https://www.google-analytics.com/mp/collect?measurement_id=G-8XEB9JV0KH&api_secret=segredo-teste',
    );
    expect(JSON.parse(init.body).events[0].params.transaction_id).toBe('ped-9');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2); // trava + resultado
  });

  it('não manda: sem secret, tag desligada, pedido de fora da vitrine ou já enviado', async () => {
    for (const o of [
      { secret: null },
      { pedido: { empresa: { config: {} } } },
      { pedido: { origem: 'REP' } },
      { trava: 0 },
      { pedido: { atribuicao: { interno: true } } }, // modo interno (19/10)
    ]) {
      const { svc, http } = montar(o);
      await svc.enviarCompra('ped-9');
      expect(http).not.toHaveBeenCalled();
    }
  });
});
