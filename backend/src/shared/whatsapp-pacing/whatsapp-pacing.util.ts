/**
 * Pacing global de envio de WhatsApp (ConfiguracaoTenant → Empresa.config.envioWhatsapp).
 * Garante espaçamento natural (humano) entre QUALQUER mensagem outbound da empresa,
 * independente do que disparou (fluxo, campanha, resposta do bot). Funções puras.
 */

export interface EnvioWhatsappConfig {
  /** Teto aprox. de envios PROATIVOS/min (abordagem, campanha) — conservador (anti-ban). */
  maxPorMinuto: number;
  /** Teto aprox. de RESPOSTAS/min a quem escreveu (faixa rápida; risco de ban baixo). */
  maxPorMinutoReativo: number;
  /** Variação aleatória mínima adicionada entre envios (segundos). */
  jitterMinSeg: number;
  /** Variação aleatória máxima adicionada entre envios (segundos). */
  jitterMaxSeg: number;
}

/**
 * Defaults: proativo conservador (~12/min → 5s base) + reativo rápido (~30/min → 2s base),
 * jitter 1–4s. Reativo é mais rápido porque responder quem te chamou não é "rajada"
 * (cliente iniciou) — o risco de ban está no disparo proativo não solicitado.
 */
export const ENVIO_WHATSAPP_DEFAULT: EnvioWhatsappConfig = {
  maxPorMinuto: 12,
  maxPorMinutoReativo: 30,
  jitterMinSeg: 1,
  jitterMaxSeg: 4,
};

const saneMax = (v: unknown, def: number): number =>
  typeof v === 'number' && v > 0 ? Math.min(Math.round(v), 600) : def;

export function resolveEnvioWhatsapp(raw: unknown): EnvioWhatsappConfig {
  const r = (raw ?? {}) as Partial<EnvioWhatsappConfig>;
  const jitterMinSeg =
    typeof r.jitterMinSeg === 'number' && r.jitterMinSeg >= 0
      ? r.jitterMinSeg
      : ENVIO_WHATSAPP_DEFAULT.jitterMinSeg;
  const jitterMaxSegRaw =
    typeof r.jitterMaxSeg === 'number' ? r.jitterMaxSeg : ENVIO_WHATSAPP_DEFAULT.jitterMaxSeg;
  return {
    maxPorMinuto: saneMax(r.maxPorMinuto, ENVIO_WHATSAPP_DEFAULT.maxPorMinuto),
    maxPorMinutoReativo: saneMax(r.maxPorMinutoReativo, ENVIO_WHATSAPP_DEFAULT.maxPorMinutoReativo),
    jitterMinSeg,
    // jitterMax nunca menor que jitterMin.
    jitterMaxSeg: Math.max(jitterMinSeg, jitterMaxSegRaw),
  };
}

/** Intervalo base entre envios em ms (60000 / msgPorMinuto). */
export function intervaloBaseMs(msgPorMinuto: number): number {
  return Math.ceil(60000 / Math.max(1, msgPorMinuto));
}

/** Jitter em ms a partir de um aleatório `rnd` ∈ [0,1). */
export function jitterMs(cfg: EnvioWhatsappConfig, rnd: number): number {
  const min = Math.max(0, cfg.jitterMinSeg) * 1000;
  const max = Math.max(min, cfg.jitterMaxSeg * 1000);
  return Math.round(min + rnd * (max - min));
}

/**
 * Quanto o cursor de envio avança a cada mensagem (base + jitter). `reativo=true`
 * usa a faixa rápida (resposta a quem escreveu); senão a faixa proativa.
 */
export function incrementoMs(cfg: EnvioWhatsappConfig, rnd: number, reativo = false): number {
  const rate = reativo ? cfg.maxPorMinutoReativo : cfg.maxPorMinuto;
  return intervaloBaseMs(rate) + jitterMs(cfg, rnd);
}
