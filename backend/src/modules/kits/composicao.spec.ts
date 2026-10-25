import { describe, expect, it } from 'vitest';
import {
  corDoCadastro,
  lerCombinacao,
  linhaDoTamanho,
  modelosDoKit,
  pecasDoKit,
  pecasNoTamanho,
  situacaoDaLegenda,
  tamanhoLimpo,
} from './composicao';

// Catálogo de mentira: Bermuda (sem Azul-Marinho), Shorts adulto + infantil, moletons.
const CAT = new Set([
  ...['Preto', 'Cinza-Escuro', 'Cinza-Claro', 'Bege', 'Verde-Militar'].flatMap((c) =>
    ['P', 'M', 'G', 'GG', 'G1', '2'].map((t) => `Bermuda de Moletom|${c}|${t}`),
  ),
  'Shorts Tactel com Zíper|Preto|M',
  'Shorts Tactel Infantil|Preto|8',
  'Moletom Canguru com Capuz|Branco|M',
  'Moletom Canguru com Capuz|Preto|M',
  'Calça de Moletom|Preto|M',
]);
const existe = (m: string, c: string, _l: string, t: string) => CAT.has(`${m}|${c}|${t}`);

describe('kits dos marketplaces: planilha → catálogo (25/10)', () => {
  it('cores da planilha viram cores do cadastro; sem par = null', () => {
    expect(corDoCadastro('Chumbo')).toBe('Cinza-Escuro');
    expect(corDoCadastro('cinza claro (mescla)')).toBe('Cinza-Claro');
    expect(corDoCadastro('militar')).toBe('Verde-Militar');
    expect(corDoCadastro('verde neon')).toBe('Neon');
    expect(corDoCadastro('Azul Claro')).toBeNull();
    expect(corDoCadastro('Vinho')).toBeNull();
  });

  it('produtos: conjunto = blusa + calça; Cores Jet e Regata DRY-FIT ficam sem par', () => {
    expect(
      modelosDoKit('Conjunto Blusa moletom canguru com capuz + Calça moletom', 'Conjunto'),
    ).toEqual(['Moletom Canguru com Capuz', 'Calça de Moletom']);
    expect(modelosDoKit('Camiseta\nmanga curta', 'DRY-FIT')).toEqual(['Camiseta UV Manga Curta']);
    expect(modelosDoKit('Bermuda Moletom', 'Cores Jet')).toEqual([]);
    expect(modelosDoKit('Camiseta Manga Regata', 'DRY-FIT')).toEqual([]);
  });

  it('combinação: "3 Preto", "A + B" e quebra de linha', () => {
    expect(lerCombinacao(' 3 Preto').cores).toEqual([{ bruta: 'Preto', cor: 'Preto', qtd: 3 }]);
    const c = lerCombinacao('Preto\nChumbo\nmescla');
    expect(c.cores.map((x) => [x.cor, x.qtd])).toEqual([
      ['Preto', 1],
      ['Cinza-Escuro', 1],
      ['Cinza-Claro', 1],
    ]);
    expect(pecasDoKit(c, 1)).toBe(3);
    // conjunto de uma cor = blusa + calça
    expect(pecasDoKit(lerCombinacao('Preto'), 2)).toBe(2);
  });

  it('tamanho e linha', () => {
    expect(tamanhoLimpo(2.0)).toBe('2');
    expect(tamanhoLimpo('gg')).toBe('GG');
    expect(linhaDoTamanho('14')).toBe('Infantil');
    expect(linhaDoTamanho('G')).toBe('Regular');
    expect(linhaDoTamanho('G2')).toBe('Plus Size');
    expect(linhaDoTamanho('3')).toBeNull();
  });

  it('peças no tamanho; cor que o produto não tem = sem composição (nunca chuta)', () => {
    expect(
      pecasNoTamanho(['Bermuda de Moletom'], lerCombinacao('Preto + Chumbo'), 'M', existe),
    ).toEqual([
      { modelo: 'Bermuda de Moletom', cor: 'Preto', quantidade: 1 },
      { modelo: 'Bermuda de Moletom', cor: 'Cinza-Escuro', quantidade: 1 },
    ]);
    // Bermuda não tem Azul-Marinho no site
    expect(
      pecasNoTamanho(['Bermuda de Moletom'], lerCombinacao('Preto + Azul Marinho'), 'M', existe),
    ).toBeNull();
    // cor sem par nenhum
    expect(
      pecasNoTamanho(['Bermuda de Moletom'], lerCombinacao('Preto + Vinho'), 'M', existe),
    ).toBeNull();
    // produto sem par
    expect(pecasNoTamanho([], lerCombinacao('Preto'), 'M', existe)).toBeNull();
  });

  it('infantil cai no modelo irmão (Shorts Tactel Infantil)', () => {
    expect(
      pecasNoTamanho(['Shorts Tactel com Zíper'], lerCombinacao('2 Preto'), '8', existe),
    ).toEqual([{ modelo: 'Shorts Tactel Infantil', cor: 'Preto', quantidade: 2 }]);
  });

  it('conjunto "Blusa X + Calça Y" usa a cor de cada papel', () => {
    const bases = ['Moletom Canguru com Capuz', 'Calça de Moletom'];
    expect(pecasNoTamanho(bases, lerCombinacao('Blusa Branco + calça Preto'), 'M', existe)).toEqual(
      [
        { modelo: 'Moletom Canguru com Capuz', cor: 'Branco', quantidade: 1 },
        { modelo: 'Calça de Moletom', cor: 'Preto', quantidade: 1 },
      ],
    );
    expect(pecasNoTamanho(bases, lerCombinacao('Preto'), 'M', existe)).toEqual([
      { modelo: 'Moletom Canguru com Capuz', cor: 'Preto', quantidade: 1 },
      { modelo: 'Calça de Moletom', cor: 'Preto', quantidade: 1 },
    ]);
  });

  it('legenda da planilha', () => {
    expect(situacaoDaLegenda('FF00FF00')).toBe('AJUSTADO_MAGIS');
    expect(situacaoDaLegenda('FFFFFFFF')).toBe('FALTA_CRIAR_MAGIS');
    expect(situacaoDaLegenda(null)).toBeNull();
  });
});
