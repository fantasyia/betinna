import { beforeEach, describe, expect, it } from 'vitest';
import { capturarCodigoInterno, codigoInterno, sairDoModoInterno } from './modo-interno';
import { _resetarGoogleTag, compraGoogle, iniciarGoogleTag } from './google-tag';

/** Modo interno da vitrine (#04/Léo, 19/10). */

const COD = 'abcdef0123456789abcdef01';
const BASE = 'https://atacado.ribelt.com.br/';

beforeEach(() => {
  localStorage.clear();
  _resetarGoogleTag();
  delete window.gtag;
  window.dataLayer = [];
});

describe('marcar o aparelho', () => {
  it('o link ?interno=<código> fica guardado e sai da barra; visita seguinte continua marcada', () => {
    window.history.replaceState(null, '', `/?utm_source=x&interno=${COD}`);
    expect(capturarCodigoInterno('loja', `${BASE}?utm_source=x&interno=${COD}`)).toBe(COD);
    expect(window.location.search).toBe('?utm_source=x');
    expect(capturarCodigoInterno('loja', BASE)).toBe(COD);
    expect(codigoInterno('outra-loja')).toBeNull();
  });

  it('código torto não marca; ?interno=sair desmarca', () => {
    expect(capturarCodigoInterno('loja', `${BASE}?interno=xyz`)).toBeNull();
    capturarCodigoInterno('loja', `${BASE}?interno=${COD}`);
    expect(sairDoModoInterno('loja', `${BASE}?interno=sair`)).toBe(true);
    expect(codigoInterno('loja')).toBeNull();
  });
});

describe('Google no modo interno', () => {
  it('GA4 como tráfego interno e nada de Google Ads (nem config, nem conversão)', () => {
    iniciarGoogleTag(
      { ga4Id: 'G-8XEB9JV0KH', adsId: 'AW-18514151629', compraSendTo: 'AW-18514151629/abc' },
      { interno: true },
    );
    compraGoogle({ pedidoId: 'p1', total: 10, pecas: 1 });
    const c = (window.dataLayer ?? []).map((a) => [...(a as IArguments)]);
    expect(c).toContainEqual(['config', 'G-8XEB9JV0KH', { traffic_type: 'internal' }]);
    expect(c.some((x) => x[0] === 'config' && x[1] === 'AW-18514151629')).toBe(false);
    expect(c.some((x) => x[1] === 'conversion')).toBe(false);
  });
});

describe('link de marcar o aparelho (tela de configuração)', () => {
  it('no domínio próprio da vitrine; sem domínio, no /v/<slug> do app', async () => {
    const { linkInterno } = await import('@/pages/vitrine/ModoInternoConfig');
    expect(linkInterno({ codigo: COD, dominio: 'atacado.ribelt.com.br', slug: 'atacado-ribelt' }, 'https://app.x')).toBe(
      `https://atacado.ribelt.com.br/?interno=${COD}`,
    );
    expect(linkInterno({ codigo: COD, dominio: null, slug: 'loja' }, 'https://app.x')).toBe(`https://app.x/v/loja?interno=${COD}`);
  });
});
