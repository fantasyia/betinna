import { describe, expect, it } from 'vitest';
import {
  atribuicaoDoJson,
  colunasPrimeiroToque,
  normalizarAtribuicao,
  normalizarFormulario,
  normalizarOrigemCadastro,
  resumoAtribuicao,
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

describe('atribuicaoDoJson', () => {
  it('extrai o bloco atribuicao do variaveis', () => {
    const a = atribuicaoDoJson({ atribuicao: { primeiro: { utmCampaign: 'x' } }, outra: 1 });
    expect(a.primeiro?.utmCampaign).toBe('x');
  });
  it('variaveis sem atribuicao / inválido → {}', () => {
    expect(atribuicaoDoJson({ origem: 'site' })).toEqual({});
    expect(atribuicaoDoJson(null)).toEqual({});
    expect(atribuicaoDoJson([1, 2])).toEqual({});
  });
});

describe('resumoAtribuicao', () => {
  it('junta colunas (1º toque) + blocos do JSON', () => {
    const r = resumoAtribuicao({
      utmSource: 'google',
      utmMedium: 'paid',
      utmCampaign: 'vtcd',
      origemCadastro: 'site',
      formularioOrigem: 'contato',
      variaveis: {
        atribuicao: { primeiro: { utmCampaign: 'vtcd' }, ultimo: { utmCampaign: 'remkt' } },
      },
    });
    expect(r).toMatchObject({
      utmSource: 'google',
      utmCampaign: 'vtcd',
      origemCadastro: 'site',
      formulario: 'contato',
      primeiro: { utmCampaign: 'vtcd' },
      ultimo: { utmCampaign: 'remkt' },
    });
  });
  it('lead sem rastreio → tudo null e blocos null', () => {
    const r = resumoAtribuicao({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      origemCadastro: null,
      formularioOrigem: null,
      variaveis: {},
    });
    expect(r).toEqual({
      origemCadastro: null,
      formulario: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      primeiro: null,
      ultimo: null,
    });
  });
});
