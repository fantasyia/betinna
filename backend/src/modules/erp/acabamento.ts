/**
 * Serviços de ACABAMENTO (Léo, 14/10): a Isabela cobra por tarefa — passar
 * cordão R$ 0,25, dobrar e embalar R$ 0,25, colocar 2 pares de ilhós R$ 0,25.
 * A lista (com preço) é da empresa, em `Empresa.config.acabamento`; cada ficha
 * técnica marca quais serviços a grade leva. Entra no custo previsto da peça e,
 * no fechamento da OP, no custo real (serviços × peças recebidas). Tudo PURO.
 */

export interface ServicoAcabamento {
  id: string;
  nome: string;
  /** R$ por peça. */
  preco: number;
}

export function servicosAcabamento(config: unknown): ServicoAcabamento[] {
  const a = ((config ?? {}) as { acabamento?: { servicos?: unknown } }).acabamento;
  const lista = Array.isArray(a?.servicos) ? (a!.servicos as ServicoAcabamento[]) : [];
  return lista.filter((s) => s && typeof s.id === 'string' && typeof s.preco === 'number');
}

/**
 * Custo de CORTE por peça (Léo, 20/10: R$ 0,45 por peça cortada). Mora junto
 * do acabamento em `Empresa.config.acabamento.custoCortePorPeca`; ausente = 0.
 * Entra no previsto de toda grade e, no corte da OP, no custo real.
 */
export function custoCortePorPeca(config: unknown): number {
  const v = ((config ?? {}) as { acabamento?: { custoCortePorPeca?: unknown } }).acabamento
    ?.custoCortePorPeca;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Frete de produção POR PEÇA (Léo, 23/10: R$ 0,15 por peça — no lugar dos
 * R$ 150 por corte). Em `config.acabamento.fretePorPeca`; ausente = 0. Entra no
 * previsto de toda grade e, no corte da OP, no custo real (editável na OP).
 */
export function fretePorPeca(config: unknown): number {
  const v = ((config ?? {}) as { acabamento?: { fretePorPeca?: unknown } }).acabamento
    ?.fretePorPeca;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Tamanhos onde cada serviço vale: { servicoId: ["8","10"] }. Ausente = todos. */
export type TamanhosServico = Record<string, string[]>;

/** Lê o JSON gravado; formato estranho vira "vale em todos" (null). PURO. */
export function lerTamanhosServico(v: unknown): TamanhosServico | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: TamanhosServico = {};
  for (const [k, xs] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(xs)) out[k] = xs.map(String);
  }
  return out;
}

/** R$ de acabamento de UMA peça de um tamanho (serviço restrito a outros tamanhos não conta). */
export function acabamentoNoTamanho(
  ids: unknown,
  servicos: ServicoAcabamento[],
  tamanhos: TamanhosServico | null,
  tamanho: string,
): number {
  if (!Array.isArray(ids)) return 0;
  const preco = new Map(servicos.map((s) => [s.id, s.preco]));
  return ids.reduce((s: number, id) => {
    const so = tamanhos?.[String(id)];
    if (so && !so.includes(tamanho)) return s;
    return s + (preco.get(String(id)) ?? 0);
  }, 0);
}

/**
 * R$ por peça da grade: soma dos serviços marcados (id que sumiu da lista não
 * conta). Serviço restrito a alguns tamanhos entra na proporção deles na grade
 * (média por tamanho, como o consumo do insumo).
 */
export function acabamentoPorPeca(
  ids: unknown,
  servicos: ServicoAcabamento[],
  tamanhos: TamanhosServico | null = null,
  tamanhosDaGrade: string[] = [],
): number {
  if (!Array.isArray(ids)) return 0;
  if (!tamanhos || tamanhosDaGrade.length === 0) {
    const preco = new Map(servicos.map((s) => [s.id, s.preco]));
    return ids.reduce((s: number, id) => s + (preco.get(String(id)) ?? 0), 0);
  }
  return (
    tamanhosDaGrade.reduce((s, t) => s + acabamentoNoTamanho(ids, servicos, tamanhos, t), 0) /
    tamanhosDaGrade.length
  );
}

/** Id estável a partir do nome ("Passar cordão" → "passar-cordao"), sem repetir. */
export function idDoServico(nome: string, usados: Set<string>): string {
  const base =
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'servico';
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
  usados.add(id);
  return id;
}
