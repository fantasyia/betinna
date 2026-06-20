/**
 * Amostra — modos + elegibilidade (ConfiguracaoTenant → Empresa.config.amostraModos).
 * Funções puras de resolução de config e decisão de fila de aprovação (testáveis).
 */

export type AmostraModo = 'subsidiada' | 'compra_propria' | 'compra_cliente';

export const AMOSTRA_MODOS: AmostraModo[] = ['subsidiada', 'compra_propria', 'compra_cliente'];

export interface AmostraModosConfig {
  /** Quais modos a empresa habilita. */
  modosAtivos: Record<AmostraModo, boolean>;
  /** Regra de elegibilidade da amostra subsidiada. */
  elegibilidadeSubsidiada: {
    /** sempre = todo cliente; media_kg_mes = exige média mínima; manual = sempre passa por aprovação. */
    tipo: 'sempre' | 'media_kg_mes' | 'manual';
    minKgMes: number;
    mesesJanela: number;
  };
  /** Se true, toda subsidiada cai na fila de aprovação da diretoria. */
  exigeAprovacaoSubsidiada: boolean;
}

/** Default backward-compat: subsidiada livre (como era antes), sem aprovação. */
export const AMOSTRA_MODOS_DEFAULT: AmostraModosConfig = {
  modosAtivos: { subsidiada: true, compra_propria: false, compra_cliente: false },
  elegibilidadeSubsidiada: { tipo: 'sempre', minKgMes: 0, mesesJanela: 3 },
  exigeAprovacaoSubsidiada: false,
};

/** Mescla a config crua (JSON do tenant) sobre os defaults, campo a campo. */
export function resolveAmostraModos(raw: unknown): AmostraModosConfig {
  const r = (raw ?? {}) as Partial<{
    modosAtivos: Partial<Record<AmostraModo, boolean>>;
    elegibilidadeSubsidiada: Partial<AmostraModosConfig['elegibilidadeSubsidiada']>;
    exigeAprovacaoSubsidiada: boolean;
  }>;
  return {
    modosAtivos: { ...AMOSTRA_MODOS_DEFAULT.modosAtivos, ...(r.modosAtivos ?? {}) },
    elegibilidadeSubsidiada: {
      ...AMOSTRA_MODOS_DEFAULT.elegibilidadeSubsidiada,
      ...(r.elegibilidadeSubsidiada ?? {}),
    },
    exigeAprovacaoSubsidiada:
      r.exigeAprovacaoSubsidiada ?? AMOSTRA_MODOS_DEFAULT.exigeAprovacaoSubsidiada,
  };
}

/** Primeiro modo ativo (fallback de `modo` quando o caller não informa). */
export function primeiroModoAtivo(cfg: AmostraModosConfig): AmostraModo | null {
  return AMOSTRA_MODOS.find((m) => cfg.modosAtivos[m]) ?? null;
}

/**
 * Decide se uma amostra subsidiada precisa de aprovação manual.
 * `mediaKgMes` só é relevante quando tipo='media_kg_mes' (senão pode ser null).
 */
export function avaliarSubsidiada(
  cfg: AmostraModosConfig,
  mediaKgMes: number | null,
): { precisaAprovacao: boolean; elegivel: boolean } {
  const eleg = cfg.elegibilidadeSubsidiada;
  let elegivel = true;
  if (eleg.tipo === 'media_kg_mes') elegivel = (mediaKgMes ?? 0) >= eleg.minKgMes;
  else if (eleg.tipo === 'manual') elegivel = false;
  const precisaAprovacao = cfg.exigeAprovacaoSubsidiada || !elegivel;
  return { precisaAprovacao, elegivel };
}
