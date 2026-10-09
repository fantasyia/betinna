import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetarPixel,
  atribuicaoParaEnvio,
  capturarAtribuicao,
  evento,
  iniciarPixel,
} from './pixel';

/** Pixel do Meta + campanha de origem na vitrine (card da #04, 09/10). */

beforeEach(() => {
  localStorage.clear();
  document.cookie.split(';').forEach((c) => {
    document.cookie = `${c.split('=')[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
  _resetarPixel();
  delete window.fbq;
  delete window._fbq;
});
afterEach(() => {
  document.head.querySelectorAll('script[src*="fbevents"]').forEach((s) => s.remove());
});

const BASE = 'https://atacado.ribelt.com.br/v/atacado-ribelt';

describe('capturarAtribuicao', () => {
  it('primeira visita vira o primeiro toque; com campanha, também o último', () => {
    capturarAtribuicao(`${BASE}?utm_source=facebook&utm_campaign=bermuda&fbclid=AbC`, 'https://l.facebook.com/');
    const a = atribuicaoParaEnvio(BASE);
    expect(a.primeiro).toMatchObject({ utmSource: 'facebook', utmCampaign: 'bermuda', fbclid: 'AbC' });
    expect(a.ultimo).toMatchObject({ utmSource: 'facebook', fbclid: 'AbC' });
  });

  it('visita sem campanha não apaga o último toque de campanha', () => {
    capturarAtribuicao(`${BASE}?utm_source=facebook`, '');
    capturarAtribuicao(BASE, '');
    expect(atribuicaoParaEnvio(BASE).ultimo).toMatchObject({ utmSource: 'facebook' });
  });

  it('primeiro toque vale 30 dias; depois, a visita nova assume', () => {
    capturarAtribuicao(`${BASE}?utm_source=antigo`, '', new Date('2026-08-01T00:00:00Z'));
    capturarAtribuicao(`${BASE}?utm_source=novo`, '', new Date('2026-10-09T00:00:00Z'));
    expect(atribuicaoParaEnvio(BASE).primeiro?.utmSource).toBe('novo');
  });

  it('sem campanha nenhuma: o "último" é a página do pedido (o Meta pede a URL do evento)', () => {
    expect(atribuicaoParaEnvio(`${BASE}?x=1`).ultimo?.landingPage).toBe(`${BASE}?x=1`);
  });
});

describe('cookies do Meta', () => {
  it('sem _fbc mas com fbclid: monta fb.1.<ms do clique>.<fbclid>', () => {
    capturarAtribuicao(`${BASE}?fbclid=AbC`, '', new Date('2026-10-09T12:00:00Z'));
    expect(atribuicaoParaEnvio(BASE).fbc).toBe(`fb.1.${Date.parse('2026-10-09T12:00:00Z')}.AbC`);
  });

  it('cookies _fbc/_fbp existentes vão como estão', () => {
    document.cookie = '_fbc=fb.1.1791500000000.XyZ; path=/';
    document.cookie = '_fbp=fb.1.1791500000000.123; path=/';
    capturarAtribuicao(`${BASE}?fbclid=AbC`, '');
    expect(atribuicaoParaEnvio(BASE)).toMatchObject({
      fbc: 'fb.1.1791500000000.XyZ',
      fbp: 'fb.1.1791500000000.123',
    });
  });
});

describe('pixel', () => {
  it('sem pixel iniciado, evento não faz nada', () => {
    evento('ViewContent', { content_ids: ['m1'] });
    expect(window.fbq).toBeUndefined();
  });

  it('inicia uma vez (PageView) e o Purchase leva o eventID do pedido', () => {
    iniciarPixel('1234567890');
    iniciarPixel('1234567890');
    const fila = window.fbq!.queue as unknown[][];
    expect(fila).toEqual([
      ['init', '1234567890'],
      ['track', 'PageView'],
    ]);
    expect(document.head.querySelectorAll('script[src*="fbevents"]')).toHaveLength(1);
    evento('Purchase', { value: 664.65, currency: 'BRL' }, 'pedido-ped-1');
    expect(fila[2]).toEqual(['track', 'Purchase', { value: 664.65, currency: 'BRL' }, { eventID: 'pedido-ped-1' }]);
  });

  it('o snippet vira o fbq real quando o script chega (callMethod)', () => {
    iniciarPixel('1234567890');
    const real = vi.fn();
    window.fbq!.callMethod = real;
    evento('AddToCart', { num_items: 3 });
    expect(real).toHaveBeenCalledWith('track', 'AddToCart', { num_items: 3 });
  });
});
