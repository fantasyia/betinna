import { describe, expect, it } from 'vitest';
import {
  campanhasMeta,
  ehLeadDeTesteMeta,
  linkDaOrigem,
  origemMeta,
  produtoDaCampanha,
} from './origem-meta';

const slugs = new Map([
  ['camiseta-uv', 'camiseta-uv'],
  ['camiseta-uv-raglan-manga-longa', 'camiseta-uv-raglan-manga-longa'],
  ['bermuda-moletom', 'bermuda-moletom-summer'], // slug antigo → atual
  ['bermuda-moletom-summer', 'bermuda-moletom-summer'],
]);

describe('origemMeta', () => {
  it('a primeira fonte com o campo ganha; vazio não entra', () => {
    expect(
      origemMeta({ campaign_name: '  ', ad_id: 'a1' }, { campaign_name: 'C', ad_id: 'a2' }, null),
    ).toEqual({ campaign_name: 'C', ad_id: 'a1' });
  });
});

describe('ehLeadDeTesteMeta', () => {
  it('reconhece o texto da ferramenta de teste do Meta', () => {
    expect(ehLeadDeTesteMeta({ full_name: '<test lead: dummy data for full_name>' })).toBe(true);
    expect(ehLeadDeTesteMeta({ full_name: 'Ana', phone_number: '+5511988880001' })).toBe(false);
  });
});

describe('produtoDaCampanha', () => {
  it('o slug MAIS LONGO escrito no nome ganha', () => {
    expect(
      produtoDaCampanha({ campaign_name: 'UV adulto · camiseta-uv-raglan-manga-longa' }, [], slugs),
    ).toBe('camiseta-uv-raglan-manga-longa');
  });

  it('pedaço de palavra não conta (camiseta-uv-x não é camiseta-uv)', () => {
    expect(produtoDaCampanha({ campaign_name: 'teste camiseta-uvx' }, [], slugs)).toBeNull();
  });

  it('slug antigo no nome leva pro atual', () => {
    expect(produtoDaCampanha({ campaign_name: 'Verão bermuda-moletom' }, [], slugs)).toBe(
      'bermuda-moletom-summer',
    );
  });

  it('sem slug na campanha, procura no conjunto e no anúncio', () => {
    expect(
      produtoDaCampanha(
        { campaign_name: 'Inverno 2026', adset_name: 'SP', ad_name: 'Vídeo camiseta-uv' },
        [],
        slugs,
      ),
    ).toBe('camiseta-uv');
  });

  it('o mapa manda (por ID ou nome exato), até pra dizer "campanha geral"', () => {
    const mapa = [
      { campanha: 'c-77', slug: 'bermuda-moletom' },
      { campanha: 'UV adulto · camiseta-uv-raglan-manga-longa', slug: '' },
    ];
    expect(produtoDaCampanha({ campaign_id: 'C-77', campaign_name: 'X' }, mapa, slugs)).toBe(
      'bermuda-moletom-summer',
    );
    expect(
      produtoDaCampanha(
        { campaign_name: 'uv adulto · camiseta-uv-raglan-manga-longa' },
        mapa,
        slugs,
      ),
    ).toBeNull();
  });

  it('slug do mapa que não é produto ativo → link geral', () => {
    expect(
      produtoDaCampanha({ campaign_id: 'c-1' }, [{ campanha: 'c-1', slug: 'sumiu' }], slugs),
    ).toBeNull();
  });
});

describe('campanhasMeta', () => {
  it('ignora linha torta', () => {
    expect(
      campanhasMeta({ metaCampanhas: [{ campanha: 'a', slug: 'b' }, { campanha: 1 }, null] }),
    ).toEqual([{ campanha: 'a', slug: 'b' }]);
    expect(campanhasMeta(null)).toEqual([]);
  });
});

describe('linkDaOrigem', () => {
  it('produto, geral e sem domínio', () => {
    expect(linkDaOrigem('https://atacado.ribelt.com.br/', 'camiseta-uv', 'UV')).toBe(
      'https://atacado.ribelt.com.br/p/camiseta-uv?utm_source=meta&utm_medium=lead&utm_campaign=UV',
    );
    expect(linkDaOrigem('atacado.ribelt.com.br', null, null)).toBe(
      'https://atacado.ribelt.com.br/?utm_source=meta&utm_medium=lead',
    );
    expect(linkDaOrigem(null, 'x', 'y')).toBe('');
  });
});
