/** Insumos (ERP próprio · entrega 2) — tipos e contas puras da tela. */

export type Unidade = 'KG' | 'METRO' | 'UNIDADE' | 'PAR';
export type TipoInsumo = 'TECIDO' | 'AVIAMENTO';

export interface Insumo {
  id: string;
  nome: string;
  tipo: TipoInsumo;
  unidade: Unidade;
  cor: string | null;
  fornecedor: string | null;
  ativo: boolean;
  custoMedio: number;
  estoqueMinimo: number | null;
  saldo: number;
  valorEmEstoque: number;
  repor: boolean;
}

export const SIGLA: Record<Unidade, string> = { KG: 'kg', METRO: 'm', UNIDADE: 'un', PAR: 'par' };
export const NOME_UNIDADE: Record<Unidade, string> = {
  KG: 'Quilo (kg)',
  METRO: 'Metro (m)',
  UNIDADE: 'Unidade',
  PAR: 'Par',
};
export const NOME_TIPO: Record<TipoInsumo, string> = { TECIDO: 'Tecido', AVIAMENTO: 'Aviamento' };

/** Mesma conta do servidor: média ponderada; saldo negativo conta como zero. */
export function custoMedioDepois(saldo: number, custo: number, qtd: number, preco: number): number {
  const base = Math.max(0, saldo);
  const total = base + qtd;
  return total <= 0 ? preco : (base * custo + qtd * preco) / total;
}

/**
 * Compra digitada pelo TOTAL pago (é o que está na nota) → preço por unidade.
 * null enquanto falta quantidade.
 */
export function precoPorUnidade(total: number | null, qtd: number | null): number | null {
  if (total === null || !qtd || qtd <= 0) return null;
  return total / qtd;
}
