/**
 * Devolução interna — config por tenant (Empresa.config.devolucaoInterna) + helpers puros.
 */

export interface DevolucaoMotivo {
  key: string;
  label: string;
  /** Fotos obrigatórias ao abrir (avaria/qualidade/erro). */
  fotosObrigatorias?: boolean;
}

export interface DevolucaoConfig {
  motivos: DevolucaoMotivo[];
  slaAnaliseDiasUteis: number;
  janelaPosEntregaDias: number;
  estornoComissaoProporcional: boolean;
}

/** Defaults MSM. */
export const DEVOLUCAO_CONFIG_DEFAULT: DevolucaoConfig = {
  motivos: [
    { key: 'avaria_transporte', label: 'Avaria no transporte', fotosObrigatorias: true },
    { key: 'validade_proxima', label: 'Validade próxima' },
    { key: 'erro_produto', label: 'Erro de produto', fotosObrigatorias: true },
    { key: 'qualidade', label: 'Qualidade', fotosObrigatorias: true },
    { key: 'recusa_cliente', label: 'Recusa do cliente' },
    { key: 'outros', label: 'Outros' },
  ],
  slaAnaliseDiasUteis: 5,
  janelaPosEntregaDias: 60,
  estornoComissaoProporcional: true,
};

export function resolveDevolucaoConfig(raw: unknown): DevolucaoConfig {
  const r = (raw ?? {}) as Partial<DevolucaoConfig>;
  const motivos = Array.isArray(r.motivos)
    ? r.motivos
        .map((m) => m as Partial<DevolucaoMotivo>)
        .filter((m) => typeof m.key === 'string' && typeof m.label === 'string')
        .map((m) => ({
          key: m.key as string,
          label: m.label as string,
          fotosObrigatorias: !!m.fotosObrigatorias,
        }))
    : DEVOLUCAO_CONFIG_DEFAULT.motivos;
  return {
    motivos: motivos.length > 0 ? motivos : DEVOLUCAO_CONFIG_DEFAULT.motivos,
    slaAnaliseDiasUteis:
      typeof r.slaAnaliseDiasUteis === 'number'
        ? r.slaAnaliseDiasUteis
        : DEVOLUCAO_CONFIG_DEFAULT.slaAnaliseDiasUteis,
    janelaPosEntregaDias:
      typeof r.janelaPosEntregaDias === 'number'
        ? r.janelaPosEntregaDias
        : DEVOLUCAO_CONFIG_DEFAULT.janelaPosEntregaDias,
    estornoComissaoProporcional:
      typeof r.estornoComissaoProporcional === 'boolean'
        ? r.estornoComissaoProporcional
        : DEVOLUCAO_CONFIG_DEFAULT.estornoComissaoProporcional,
  };
}

/** Soma N dias úteis (pula sábado/domingo) a partir de `base`. Não considera feriados. */
export function addDiasUteis(base: Date, dias: number): Date {
  const d = new Date(base.getTime());
  let restantes = dias;
  while (restantes > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) restantes -= 1;
  }
  return d;
}

/** Transições de lifecycle permitidas (set genérico bloqueado fora delas). */
export const DEVOLUCAO_TRANSICOES: Record<string, string[]> = {
  ABERTA: ['EM_ANALISE', 'RECUSADA'],
  EM_ANALISE: ['APROVADA', 'RECUSADA'],
  APROVADA: ['NF_DEVOLUCAO_EMITIDA'],
  NF_DEVOLUCAO_EMITIDA: ['COLETA_AGENDADA'],
  COLETA_AGENDADA: ['COLETADA'],
  COLETADA: ['RESOLVIDA'],
  RESOLVIDA: [],
  RECUSADA: [],
};
