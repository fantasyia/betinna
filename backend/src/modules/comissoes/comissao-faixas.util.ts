/**
 * Comissão escalonada por faturamento (ConfiguracaoTenant → Empresa.config.comissaoBonus).
 * Função pura: dado o faturamento mensal do rep, retorna o % da faixa.
 * Backward-compat: modelo 'fixa' (ou sem config) = comportamento atual
 * (soma do `comissao` pré-calculado por pedido).
 */

export type ComissaoModelo = 'fixa' | 'escalonada_por_faturamento';

export interface ComissaoFaixa {
  /** Início do intervalo de faturamento mensal (R$), inclusive. */
  de: number;
  /** Fim do intervalo (R$), inclusive. null = aberto (faixa mais alta). */
  ate: number | null;
  /** % de comissão aplicada sobre o faturamento do rep nessa faixa. */
  percentual: number;
}

export interface ComissaoBonusConfig {
  modelo: ComissaoModelo;
  faixas: ComissaoFaixa[];
}

export const COMISSAO_BONUS_DEFAULT: ComissaoBonusConfig = { modelo: 'fixa', faixas: [] };

/** Mescla a config crua (JSON do tenant) sobre os defaults, saneando tipos. */
export function resolveComissaoBonus(raw: unknown): ComissaoBonusConfig {
  const r = (raw ?? {}) as Partial<{ modelo: unknown; faixas: unknown }>;
  const modelo: ComissaoModelo =
    r.modelo === 'escalonada_por_faturamento' ? 'escalonada_por_faturamento' : 'fixa';
  const faixas: ComissaoFaixa[] = Array.isArray(r.faixas)
    ? (r.faixas as unknown[])
        .map((f) => f as Partial<ComissaoFaixa>)
        .filter((f) => typeof f.de === 'number' && typeof f.percentual === 'number')
        .map((f) => ({
          de: f.de as number,
          ate: typeof f.ate === 'number' ? f.ate : null,
          percentual: f.percentual as number,
        }))
    : [];
  return { modelo, faixas };
}

/**
 * % da faixa cujo intervalo [de, ate] contém o faturamento (ate=null = aberto).
 * Faixas ordenadas por `de`; primeira que casa vence. Sem match → 0.
 */
export function faixaPercentual(faixas: ComissaoFaixa[], faturamento: number): number {
  const ordenadas = [...faixas].sort((a, b) => a.de - b.de);
  for (const f of ordenadas) {
    if (faturamento >= f.de && (f.ate == null || faturamento <= f.ate)) return f.percentual;
  }
  return 0;
}
