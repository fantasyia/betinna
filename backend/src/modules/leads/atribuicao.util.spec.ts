import { describe, expect, it } from 'vitest';
import {
  colunasPrimeiroToque,
  normalizarAtribuicao,
  normalizarFormulario,
  normalizarOrigemCadastro,
} from './atribuicao.util';

describe('normalizarAtribuicao', () => {
  it('lowercase+trim nos agrupadores; preserva caixa em gclid/fbclid/URLs', () => {
    const r = normalizarAtribuicao({
      primeiro: {
        utmSource: '  Google ',
        utmMedium: 'PAID',
        utmCampaign: 'VTCD-Alimenticia ',
        utmContent: 'Criativo-03',
        gclid: 'Cj0KCQ-AbC', // case-sensitive → intacto
        fbclid: 'IwAR-XyZ',
        landingPage: '/Solucoes/Master-Block',
        referrer: 'https://www.Google.com/',
      },
    });
    expect(r?.primeiro).toMatchObject({
      utmSource: 'google',
      utmMedium: 'paid',
      utmCampaign: 'vtcd-alimenticia',
      utmContent: 'Criativo-03', // NÃO lowercased
      gclid: 'Cj0KCQ-AbC',
      fbclid: 'IwAR-XyZ',
      landingPage: '/Solucoes/Master-Block',
      referrer: 'https://www.Google.com/',
    });
  });

  it('strip de caracteres de controle (anti-XSS na ingestão)', () => {
    const r = normalizarAtribuicao({ primeiro: { utmCampaign: 'campanha\x01\x1f-x' } });
    expect(r?.primeiro?.utmCampaign).toBe('campanha-x');
  });

  it('corta em 255 caracteres', () => {
    const r = normalizarAtribuicao({ primeiro: { utmTerm: 'a'.repeat(500) } });
    expect(r?.primeiro?.utmTerm).toHaveLength(255);
  });

  it('vazio/ausente → undefined (não cria bloco fantasma)', () => {
    expect(normalizarAtribuicao(undefined)).toBeUndefined();
    expect(normalizarAtribuicao({})).toBeUndefined();
    expect(normalizarAtribuicao({ primeiro: { utmSource: '   ' } })).toBeUndefined();
  });

  it('mantém primeiro E último separados', () => {
    const r = normalizarAtribuicao({
      primeiro: { utmCampaign: 'blog-seo' },
      ultimo: { utmCampaign: 'google-keyword' },
    });
    expect(r?.primeiro?.utmCampaign).toBe('blog-seo');
    expect(r?.ultimo?.utmCampaign).toBe('google-keyword');
  });
});

describe('colunasPrimeiroToque', () => {
  it('extrai só source/medium/campaign do PRIMEIRO toque', () => {
    expect(
      colunasPrimeiroToque({
        primeiro: { utmSource: 'ig', utmMedium: 'organic', utmCampaign: 'x' },
      }),
    ).toEqual({ utmSource: 'ig', utmMedium: 'organic', utmCampaign: 'x' });
  });
  it('sem atribuição → tudo null', () => {
    expect(colunasPrimeiroToque(undefined)).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    });
  });
});

describe('normalizarOrigemCadastro', () => {
  it('válido (lower) passa', () => {
    expect(normalizarOrigemCadastro('MANUAL_REP')).toBe('manual_rep');
  });
  it('ausente/inválido → fallback (nunca derruba o lead)', () => {
    expect(normalizarOrigemCadastro(undefined)).toBe('site');
    expect(normalizarOrigemCadastro('lixo')).toBe('site');
    expect(normalizarOrigemCadastro('lixo', 'importacao')).toBe('importacao');
  });
});

describe('normalizarFormulario', () => {
  it('lower+trim, corta em 40', () => {
    expect(normalizarFormulario('  Calculadora ')).toBe('calculadora');
    expect(normalizarFormulario('x'.repeat(60))).toHaveLength(40);
  });
});
