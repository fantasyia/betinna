import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarCarregadorDeMidia, type MidiaUrl } from './midia-em-lote';

/**
 * O lote de mídia da Inbox (card 429 — Sentry BETINNA-FRONT-B, 24/09).
 *
 * Antes: 50 mídias numa conversa = 50 GETs no mesmo segundo, contra 10/s da
 * EMPRESA. O que se trava aqui é que os pedidos de um mesmo render viram UMA
 * requisição, e que cada player recebe a SUA resposta.
 */

const url = (id: string): MidiaUrl => ({ url: `https://assinada/${id}`, mime: 'image/jpeg' });

describe('criarCarregadorDeMidia', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('🔴 50 pedidos no mesmo render viram UMA requisição', async () => {
    const buscar = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, url(id)])),
    );
    const carregar = criarCarregadorDeMidia(buscar);
    const pedidos = Array.from({ length: 50 }, (_, i) => carregar(`m${i}`));
    await vi.runAllTimersAsync();
    const respostas = await Promise.all(pedidos);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar.mock.calls[0][0]).toHaveLength(50);
    expect(respostas[7]).toEqual(url('m7'));
  });

  it('o mesmo id pedido por dois players vai UMA vez e resolve os dois', async () => {
    const buscar = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, url(id)])),
    );
    const carregar = criarCarregadorDeMidia(buscar);
    const a = carregar('m1');
    const b = carregar('m1');
    await vi.runAllTimersAsync();
    expect(await a).toEqual(url('m1'));
    expect(await b).toEqual(url('m1'));
    expect(buscar.mock.calls[0][0]).toEqual(['m1']);
  });

  it('respeita o teto do backend: 150 pedidos = 2 requisições (100 + 50)', async () => {
    const buscar = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, url(id)])),
    );
    const carregar = criarCarregadorDeMidia(buscar);
    const pedidos = Array.from({ length: 150 }, (_, i) => carregar(`m${i}`));
    await vi.runAllTimersAsync();
    await Promise.all(pedidos);
    expect(buscar.mock.calls.map((c) => c[0].length)).toEqual([100, 50]);
  });

  it('mídia que volta null rejeita SÓ o pedido dela', async () => {
    const carregar = criarCarregadorDeMidia(async () => ({ m1: url('m1'), m2: null }));
    // `.catch` ANTES de rodar os timers: a rejeição acontece dentro do
    // runAllTimers, e sem handler pendurado o Vitest acusa "unhandled".
    const ok = carregar('m1');
    const falha = carregar('m2').catch((e: Error) => e);
    const faltou = carregar('m3').catch((e: Error) => e); // nem veio na resposta
    await vi.runAllTimersAsync();
    expect(await ok).toEqual(url('m1'));
    expect(String(await falha)).toMatch(/indisponível/);
    expect(String(await faltou)).toMatch(/indisponível/);
  });

  it('requisição que falha (429, rede) rejeita os pedidos daquele lote', async () => {
    const carregar = criarCarregadorDeMidia(async () => {
      throw new Error('429');
    });
    const a = carregar('m1').catch((e: Error) => e);
    const b = carregar('m2').catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect(String(await a)).toContain('429');
    expect(String(await b)).toContain('429');
  });

  it('"tentar de novo" depois do lote abre uma requisição nova só com aquele id', async () => {
    const buscar = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, url(id)])),
    );
    const carregar = criarCarregadorDeMidia(buscar);
    void carregar('m1');
    void carregar('m2');
    await vi.runAllTimersAsync();
    const retry = carregar('m2');
    await vi.runAllTimersAsync();
    expect(await retry).toEqual(url('m2'));
    expect(buscar.mock.calls.map((c) => c[0])).toEqual([['m1', 'm2'], ['m2']]);
  });
});
