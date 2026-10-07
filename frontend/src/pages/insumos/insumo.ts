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
  /** Com cores: saldo, custo e movimento são POR COR (Léo, 07/10). */
  temCores: boolean;
  cores: CorInsumo[];
}

/** Uma cor do insumo (Moletinho Preto), com saldo e custo próprios. */
export interface CorInsumo {
  /** id da cor DO insumo — é o que vai no movimento (`insumoCorId`). */
  id: string;
  /** id da cor na lista da empresa. */
  corId: string;
  nome: string;
  hex: string;
  ativo: boolean;
  custoMedio: number;
  saldo: number;
  valorEmEstoque: number;
  repor: boolean;
}

/** Cor da lista da empresa (a mesma da vitrine). */
export interface CorEmpresa {
  id: string;
  nome: string;
  hex: string;
  ativo: boolean;
}

/** Cores em que dá pra lançar movimento (as desligadas só aparecem com saldo). */
export const coresAtivas = (i: Insumo) => i.cores.filter((c) => c.ativo);

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
