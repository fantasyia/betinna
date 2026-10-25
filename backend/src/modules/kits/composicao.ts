/**
 * Kits dos marketplaces (25/10, card cmvnyodx7): traduz a planilha do Léo pro
 * catálogo. Nome do produto da planilha → produto(s) do site, nome de cor →
 * cor do cadastro, combinação → peças por cor, tamanho → linha. PURO.
 *
 * Regra: o que não tem par no site (Regata DRY-FIT, Bermuda "Cores Jet", azul
 * claro, vinho, marrom, verde água, rosa) fica SEM composição — nunca chuta
 * uma peça parecida. "Cores Aleatórias" também fica sem (Léo define depois).
 */

/** Peça de um kit: quantas de cada cor, em qual produto do site. */
export interface PecaDoKit {
  modelo: string;
  cor: string;
  quantidade: number;
}

const sem = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Cor da planilha → cor do cadastro (null = não existe no site). */
export function corDoCadastro(bruta: string): string | null {
  const c = sem(bruta).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const mapa: Array<[RegExp, string]> = [
    [/^(cinza claro|cinza-claro|mescla|cinza claro mescla)$/, 'Cinza-Claro'],
    [/^(chumbo|cinza escuro|cinza-escuro)$/, 'Cinza-Escuro'],
    [/^(militar|verde militar|verde-militar)$/, 'Verde-Militar'],
    [/^(marinho|azul marinho|azul-marinho)$/, 'Azul-Marinho'],
    [/^(neon|verde neon)$/, 'Neon'],
    [/^preto$/, 'Preto'],
    [/^branco$/, 'Branco'],
    [/^bege$/, 'Bege'],
    [/^vermelho$/, 'Vermelho'],
  ];
  for (const [re, nome] of mapa) if (re.test(c)) return nome;
  return null;
}

/**
 * Produto(s) do site que o kit consome. Conjunto = blusa + calça (nessa ordem).
 * Lista vazia = sem par no site.
 */
export function modelosDoKit(produto: string, modelo: string): string[] {
  const p = sem(produto);
  const m = sem(modelo);
  if (p.startsWith('conjunto')) {
    const blusa = p.includes('ziper')
      ? 'Moletom com Zíper e Capuz'
      : p.includes('gola careca')
        ? 'Moletom Gola Careca'
        : p.includes('canguru')
          ? 'Moletom Canguru com Capuz'
          : null;
    return blusa ? [blusa, 'Calça de Moletom'] : [];
  }
  if (p === 'camiseta manga curta' && m === 'dry-fit') return ['Camiseta UV Manga Curta'];
  if (p === 'camiseta manga longa' && m === 'uv') return ['Camiseta UV Manga Longa'];
  if (p === 'camiseta manga curta' && m.startsWith('meia malha'))
    return ['Camiseta Básica Manga Curta'];
  if (p === 'camiseta manga longa' && m.startsWith('meia malha'))
    return ['Camiseta Básica Manga Longa'];
  if (p === 'camiseta manga regata' && m.startsWith('meia malha')) return ['Regata Básica'];
  if (p === 'bermuda moletom' && m === 'cores lisas') return ['Bermuda de Moletom'];
  if (p === 'calca moletom' && m === 'jogger') return ['Calça de Moletom'];
  if (p === 'blusa moletom' && m === 'canguru com capuz') return ['Moletom Canguru com Capuz'];
  if (p === 'blusa moletom' && m === 'gola careca') return ['Moletom Gola Careca'];
  if (p === 'blusa moletom' && m === 'com ziper') return ['Moletom com Zíper e Capuz'];
  if (p === 'shorts tactel') return ['Shorts Tactel com Zíper'];
  return [];
}

/**
 * Infantil do mesmo produto pode ser OUTRO modelo no site (Shorts Tactel
 * Infantil). Tenta o modelo do kit e, se não tiver o tamanho, o irmão.
 */
export const IRMAO_INFANTIL: Record<string, string> = {
  'Shorts Tactel com Zíper': 'Shorts Tactel Infantil',
};

/** Linha do tamanho: 2–14 Infantil, P–GG Regular, G1–G3 Plus Size. */
export function linhaDoTamanho(t: string): 'Infantil' | 'Regular' | 'Plus Size' | null {
  const s = t.trim().toUpperCase();
  if (/^(2|4|6|8|10|12|14)$/.test(s)) return 'Infantil';
  if (/^(P|M|G|GG)$/.test(s)) return 'Regular';
  if (/^G[1-3]$/.test(s)) return 'Plus Size';
  return null;
}

/** Tamanho como vem da planilha (2.0 → "2"). */
export function tamanhoLimpo(t: unknown): string {
  if (typeof t === 'number') return String(Math.round(t));
  return String(t ?? '')
    .trim()
    .replace(/\.0$/, '')
    .toUpperCase();
}

export interface Combinacao {
  /** Cor da planilha → quantas peças (por produto base). Ordem preservada. */
  cores: Array<{ bruta: string; cor: string | null; qtd: number }>;
  /** Só pro conjunto "Blusa X + Calça Y": cor por papel. */
  porPapel?: { blusa: string; calca: string };
}

/**
 * "3 Preto" → 3×Preto; "Preto + Chumbo" → 1+1; aceita quebra de linha como
 * separador; "Blusa Branco + calça Preto" (conjunto) → cor por papel.
 */
export function lerCombinacao(texto: string): Combinacao {
  const partes = String(texto)
    .split(/\s*(?:\+|\n)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const blusa = partes.find((p) => /^blusa\s/i.test(p));
  const calca = partes.find((p) => /^cal[cç]a\s/i.test(p));
  if (blusa && calca && partes.length === 2) {
    const b = blusa.replace(/^blusa\s+/i, '');
    const c = calca.replace(/^cal[cç]a\s+/i, '');
    return {
      cores: [
        { bruta: b, cor: corDoCadastro(b), qtd: 1 },
        { bruta: c, cor: corDoCadastro(c), qtd: 1 },
      ],
      porPapel: { blusa: b, calca: c },
    };
  }
  const cores: Combinacao['cores'] = [];
  for (const p of partes) {
    const m = /^(\d+)\s+(.+)$/.exec(p);
    const qtd = m ? Number(m[1]) : 1;
    const bruta = m ? m[2] : p;
    const cor = corDoCadastro(bruta);
    const igual = cores.find((x) => x.cor !== null && x.cor === cor);
    if (igual) igual.qtd += qtd;
    else cores.push({ bruta, cor, qtd });
  }
  return { cores };
}

/** Peças por kit: soma das cores × produtos base (conjunto = 2 peças por cor). */
export function pecasDoKit(c: Combinacao, bases: number): number {
  if (c.porPapel) return 2;
  const porBase = c.cores.reduce((s, x) => s + x.qtd, 0);
  return porBase * Math.max(1, bases);
}

/**
 * Peças que o kit consome num tamanho. `null` = falta par (cor ou produto que
 * não existe no site, ou variação ausente) → kit fica sem composição.
 */
export function pecasNoTamanho(
  bases: string[],
  c: Combinacao,
  tamanho: string,
  existe: (modelo: string, cor: string, linha: string, tamanho: string) => boolean,
): PecaDoKit[] | null {
  const linha = linhaDoTamanho(tamanho);
  if (!bases.length || !linha) return null;
  const pecas: PecaDoKit[] = [];
  const achar = (modelo: string, cor: string): string | null => {
    if (existe(modelo, cor, linha, tamanho)) return modelo;
    const irmao = IRMAO_INFANTIL[modelo];
    return irmao && existe(irmao, cor, linha, tamanho) ? irmao : null;
  };
  if (c.porPapel) {
    const [mb, mc] = bases;
    const cb = corDoCadastro(c.porPapel.blusa);
    const cc = corDoCadastro(c.porPapel.calca);
    if (!mb || !mc || !cb || !cc) return null;
    const b = achar(mb, cb);
    const k = achar(mc, cc);
    if (!b || !k) return null;
    return [
      { modelo: b, cor: cb, quantidade: 1 },
      { modelo: k, cor: cc, quantidade: 1 },
    ];
  }
  for (const base of bases) {
    for (const x of c.cores) {
      if (!x.cor) return null;
      const m = achar(base, x.cor);
      if (!m) return null;
      pecas.push({ modelo: m, cor: x.cor, quantidade: x.qtd });
    }
  }
  return pecas;
}

/** Legenda de cor da planilha → situação no Magis5. */
export function situacaoDaLegenda(fundo: string | null | undefined): string | null {
  switch ((fundo ?? '').toUpperCase()) {
    case 'FF00FF00':
      return 'AJUSTADO_MAGIS';
    case 'FFFFFFFF':
      return 'FALTA_CRIAR_MAGIS';
    case 'FFFF0000':
      return 'SEM_SKU_MAGIS';
    case 'FFFFFF00':
      return 'FALTA_AJUSTAR_VARIACAO';
    case 'FFD5A6BD':
      return 'REVISAR';
    default:
      return null;
  }
}
