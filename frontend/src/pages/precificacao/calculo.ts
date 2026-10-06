/**
 * Calculadora de precificação — as contas. PURO e testado: porta a calculadora
 * de referência da Ribelt (docs/precificacao/calculadora-precos.html), com as
 * faixas e o pedido mínimo vindos do cadastro em vez de fixos no código.
 *
 *   custos do pedido = peças × custo + (imposto + taxa) × receita
 *                      + anúncio por pedido + embalagem por pedido
 *   lucro = receita − custos · margem = lucro ÷ receita
 */

export type Faixa = 'entrada' | 'volume' | 'atacadao';

export const NOME_FAIXA: Record<Faixa, string> = {
  entrada: 'Entrada',
  volume: 'Volume',
  atacadao: 'Atacadão',
};

export interface Simulacao {
  custo: number;
  impostoPct: number;
  /** Taxa do meio de pagamento escolhido (Pix ou cartão). */
  taxaPct: number;
  anuncioPorPedido: number;
  embalagemPorPedido: number;
  precos: { entrada: number | null; volume: number | null; atacadao: number | null };
  sugerido: number | null;
  faixas: { minimoVolume: number | null; minimoAtacadao: number | null };
  minimo: { valorMin: number | null; quantidadeMin: number | null; modo: 'E' | 'OU' } | null;
}

export function faixaDe(q: number, f: Simulacao['faixas']): Faixa {
  if (f.minimoAtacadao && q >= f.minimoAtacadao) return 'atacadao';
  if (f.minimoVolume && q >= f.minimoVolume) return 'volume';
  return 'entrada';
}

/**
 * Preço por peça na faixa — a MESMA regra da vitrine: faixa melhor sem preço
 * usa a de baixo; nenhuma = null ("sob consulta"). Assim a calculadora mostra o
 * que o cliente vai pagar de verdade.
 */
export function precoDe(q: number, s: Simulacao): number | null {
  const fx = faixaDe(q, s.faixas);
  const ordem: Faixa[] =
    fx === 'atacadao' ? ['atacadao', 'volume', 'entrada'] : fx === 'volume' ? ['volume', 'entrada'] : ['entrada'];
  for (const k of ordem) {
    const v = s.precos[k];
    if (v !== null && v > 0) return v;
  }
  return null;
}

export interface Conta {
  q: number;
  faixa: Faixa;
  preco: number | null;
  receita: number;
  custos: number;
  lucro: number;
  lucroPorPeca: number;
  margem: number;
  /** Revenda sugerida − preço da faixa (e % sobre o preço). null sem os dois. */
  lojista: { porPeca: number; pct: number } | null;
  /** O pedido fecha nessa quantidade (pedido mínimo atingido)? */
  fecha: boolean;
}

export function conta(q: number, s: Simulacao): Conta {
  const preco = precoDe(q, s);
  const p = preco ?? 0;
  const receita = p * q;
  const custos =
    s.custo * q +
    receita * (s.impostoPct / 100) +
    receita * (s.taxaPct / 100) +
    s.anuncioPorPedido +
    s.embalagemPorPedido;
  const lucro = receita - custos;
  return {
    q,
    faixa: faixaDe(q, s.faixas),
    preco,
    receita,
    custos,
    lucro,
    lucroPorPeca: q ? lucro / q : 0,
    margem: receita ? lucro / receita : 0,
    lojista:
      s.sugerido && preco ? { porPeca: s.sugerido - preco, pct: Math.round(((s.sugerido - preco) / preco) * 100) } : null,
    fecha: fecha(q, receita, s.minimo),
  };
}

function fecha(q: number, receita: number, m: Simulacao['minimo']): boolean {
  const crit: boolean[] = [];
  if (m?.quantidadeMin) crit.push(q >= m.quantidadeMin);
  if (m?.valorMin) crit.push(receita >= m.valorMin);
  if (crit.length === 0) return true;
  return m?.modo === 'OU' ? crit.some(Boolean) : crit.every(Boolean);
}

/**
 * O menor pedido que fecha. "OU": o que vier primeiro entre as peças mínimas e
 * as peças que atingem o valor mínimo no preço de Entrada; "E": o maior dos dois.
 */
export function pedidoMinimoEmPecas(s: Simulacao): number | null {
  const m = s.minimo;
  if (!m || (!m.valorMin && !m.quantidadeMin)) return null;
  const pE = precoDe(1, s);
  const porValor = m.valorMin && pE ? Math.max(1, Math.ceil(m.valorMin / pE)) : null;
  const porPecas = m.quantidadeMin || null;
  const candidatos = [porValor, porPecas].filter((x): x is number => x !== null);
  if (candidatos.length === 0) return null;
  return m.modo === 'OU' ? Math.min(...candidatos) : Math.max(...candidatos);
}

/**
 * As linhas do resultado: pedido mínimo, início do Volume, início do Atacadão
 * e a quantidade digitada — sempre as mesmas em cartões e tabela.
 */
export function quantidades(s: Simulacao, extra?: number | null): { fixas: number[]; todas: number[]; minimo: number | null } {
  const minimo = pedidoMinimoEmPecas(s);
  const base = minimo ?? 1;
  const fixas = [...new Set([base, s.faixas.minimoVolume, s.faixas.minimoAtacadao])]
    .filter((q): q is number => typeof q === 'number' && q >= base)
    .sort((a, b) => a - b);
  const todas = [...fixas];
  const e = extra ? Math.round(extra) : 0;
  if (e > 0 && !todas.includes(e)) todas.push(e);
  todas.sort((a, b) => a - b);
  return { fixas, todas, minimo };
}

/**
 * "Quanto cobrar pra lucrar o que eu quero": preço mínimo por peça pra ter
 * `lucroPorPeca` num pedido de `q` peças. null quando imposto + taxa ≥ 100%.
 */
export function precoParaLucro(lucroPorPeca: number, q: number, s: Simulacao): number | null {
  const den = 1 - s.impostoPct / 100 - s.taxaPct / 100;
  if (den <= 0 || q <= 0) return null;
  const fixoPorPeca = (s.anuncioPorPedido + s.embalagemPorPedido) / q;
  return (s.custo + fixoPorPeca + lucroPorPeca) / den;
}

/** Texto digitado ("9,70", "1.234,5") → número; vazio/ruim → null. */
export function lerNumero(t: string): number | null {
  const s = t.trim();
  if (!s) return null;
  const x = Number.parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : null;
}

/** Número → texto de campo ("9,7"); null → "". */
export function paraCampo(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v).replace('.', ',');
}
