import { createCipheriv } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { assinarShein } from './shein-assinatura';
import { assinaturaWebhookValida, eventoShein } from './shein-webhook';
import { SheinWebhookController } from './shein-webhook.controller';

/** Webhook da Shein (Léo, 02/11). */
const APP = 'F19202C54001A543486982AE392D';
const SEGREDO = '35BCFA6F4CD843B9B0083B18A38A7062';
const CAMINHO = '/api/v1/webhooks/shein';

function cifrar(obj: unknown, segredo = SEGREDO): string {
  const c = createCipheriv(
    'aes-128-cbc',
    Buffer.from(segredo).subarray(0, 16),
    Buffer.from('space-station-de'),
  );
  return Buffer.concat([c.update(JSON.stringify(obj)), c.final()]).toString('base64');
}

describe('webhook da Shein — regras', () => {
  it('assinatura do callback: par do APP sobre appid&timestamp&caminho', () => {
    const ts = '1793640000000';
    const { assinatura } = assinarShein(APP, SEGREDO, CAMINHO, Number(ts), 'Xy7Qp');
    expect(assinaturaWebhookValida(assinatura, APP, SEGREDO, CAMINHO, ts)).toBe(true);
    expect(assinaturaWebhookValida(assinatura, APP, 'outro-segredo', CAMINHO, ts)).toBe(false);
    expect(assinaturaWebhookValida(assinatura, APP, SEGREDO, '/outro', ts)).toBe(false);
    expect(assinaturaWebhookValida(assinatura, APP, SEGREDO, CAMINHO, '1793640000001')).toBe(false);
    expect(assinaturaWebhookValida('', APP, SEGREDO, CAMINHO, ts)).toBe(false);
  });

  it('eventData decifra com o segredo do app (AES-128-CBC, IV fixo)', () => {
    const ev = { orderNo: 'GSHND026A000YW2', changeTime: 1706769529786, orderStatus: 1 };
    expect(eventoShein(cifrar(ev), SEGREDO)).toEqual(ev);
    expect(() => eventoShein(cifrar(ev, 'X'.repeat(32)), SEGREDO)).toThrow();
  });
});

describe('webhook da Shein — controller', () => {
  function montar() {
    const shein = {
      resolverPorChaves: vi.fn().mockResolvedValue({ empresaId: 'emp1', appSecret: SEGREDO }),
    };
    const pedidos = { sincronizarPedido: vi.fn().mockResolvedValue(true) };
    const posVenda = { sincronizarCaso: vi.fn().mockResolvedValue(true) };
    const antiReplay = { checkAndMarkWebhook: vi.fn().mockResolvedValue({ fresh: true }) };
    const ctrl = new SheinWebhookController(
      shein as never,
      pedidos as never,
      posVenda as never,
      antiReplay as never,
    );
    return { ctrl, shein, pedidos, posVenda, antiReplay };
  }
  const req = { originalUrl: `${CAMINHO}?x=1` } as Request;
  const esperarFila = () => new Promise((r) => setImmediate(r));

  function chamar(m: ReturnType<typeof montar>, evento: string, dados: unknown, segredo = SEGREDO) {
    const ts = String(Date.now());
    const { assinatura } = assinarShein(APP, segredo, CAMINHO, Number(ts));
    return m.ctrl.receive(req, APP, 'OPEN1', evento, ts, assinatura, {
      eventData: cifrar(dados),
    });
  }

  it('pedido: responde na hora e depois busca o pedido de verdade', async () => {
    const m = montar();
    const r = await chamar(m, 'order_push_notice', { orderNo: 'GSO1', orderStatus: 2 });
    expect(r).toEqual({ ok: true });
    expect(m.shein.resolverPorChaves).toHaveBeenCalledWith(APP, 'OPEN1');
    await esperarFila();
    expect(m.pedidos.sincronizarPedido).toHaveBeenCalledWith('emp1', 'GSO1');
  });

  it('pós-venda: grava o caso em Incidentes', async () => {
    const m = montar();
    await chamar(m, 'aftersales_push_notice', { aftersalesOrderNo: 'AC1', orderNo: 'GSO1' });
    await esperarFila();
    expect(m.posVenda.sincronizarCaso).toHaveBeenCalledWith('emp1', 'AC1');
  });

  it('devolução: puxa os casos de pós-venda que mudaram', async () => {
    const m = montar();
    const posVenda = m.posVenda as unknown as { sincronizar: ReturnType<typeof vi.fn> };
    posVenda.sincronizar = vi.fn().mockResolvedValue({ casos: 2, falhas: 0 });
    await chamar(m, 'return_order_push_notice', { returnOrderNo: 'ND67E08VAR' });
    await esperarFila();
    expect(posVenda.sincronizar).toHaveBeenCalledWith('emp1', expect.any(Date), 2);
  });

  it('assinatura errada NÃO processa nada', async () => {
    const m = montar();
    const r = await chamar(m, 'order_push_notice', { orderNo: 'GSO1' }, 'segredo-errado-0000');
    expect(r).toEqual({ ok: false });
    await esperarFila();
    expect(m.antiReplay.checkAndMarkWebhook).not.toHaveBeenCalled();
    expect(m.pedidos.sincronizarPedido).not.toHaveBeenCalled();
  });

  it('repetido (anti-replay) não processa de novo', async () => {
    const m = montar();
    m.antiReplay.checkAndMarkWebhook.mockResolvedValue({ fresh: false });
    expect(await chamar(m, 'order_push_notice', { orderNo: 'GSO1' })).toEqual({ ok: true });
    await esperarFila();
    expect(m.pedidos.sincronizarPedido).not.toHaveBeenCalled();
  });

  it('app/loja sem conexão: ignora', async () => {
    const m = montar();
    m.shein.resolverPorChaves.mockResolvedValue(null);
    expect(await chamar(m, 'order_push_notice', { orderNo: 'GSO1' })).toEqual({ ok: false });
    await esperarFila();
    expect(m.pedidos.sincronizarPedido).not.toHaveBeenCalled();
  });
});
