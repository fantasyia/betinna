/**
 * Pacing global de envio de WhatsApp (ConfiguracaoTenant → Empresa.config.envioWhatsapp).
 * Garante espaçamento natural (humano) entre QUALQUER mensagem outbound da empresa,
 * independente do que disparou (fluxo, campanha, resposta do bot). Funções puras.
 */

export interface EnvioWhatsappConfig {
  /** Teto aproximado de mensagens por minuto por empresa (define o intervalo base). */
  maxPorMinuto: number;
  /** Variação aleatória mínima adicionada entre envios (segundos). */
  jitterMinSeg: number;
  /** Variação aleatória máxima adicionada entre envios (segundos). */
  jitterMaxSeg: number;
}

/** Default conservador (anti-ban + humano): ~1 a cada 4s + jitter 1–5s → ~5–9s entre envios. */
export const ENVIO_WHATSAPP_DEFAULT: EnvioWhatsappConfig = {
  maxPorMinuto: 15,
  jitterMinSeg: 1,
  jitterMaxSeg: 5,
};

export function resolveEnvioWhatsapp(raw: unknown): EnvioWhatsappConfig {
  const r = (raw ?? {}) as Partial<EnvioWhatsappConfig>;
  const maxPorMinuto =
    typeof r.maxPorMinuto === 'number' && r.maxPorMinuto > 0
      ? Math.min(r.maxPorMinuto, 600)
      : ENVIO_WHATSAPP_DEFAULT.maxPorMinuto;
  const jitterMinSeg =
    typeof r.jitterMinSeg === 'number' && r.jitterMinSeg >= 0
      ? r.jitterMinSeg
      : ENVIO_WHATSAPP_DEFAULT.jitterMinSeg;
  const jitterMaxSegRaw =
    typeof r.jitterMaxSeg === 'number' ? r.jitterMaxSeg : ENVIO_WHATSAPP_DEFAULT.jitterMaxSeg;
  // jitterMax nunca menor que jitterMin.
  const jitterMaxSeg = Math.max(jitterMinSeg, jitterMaxSegRaw);
  return { maxPorMinuto, jitterMinSeg, jitterMaxSeg };
}

/** Intervalo base entre envios em ms (60000 / maxPorMinuto). */
export function intervaloBaseMs(cfg: EnvioWhatsappConfig): number {
  return Math.ceil(60000 / Math.max(1, cfg.maxPorMinuto));
}

/** Jitter em ms a partir de um aleatório `rnd` ∈ [0,1). */
export function jitterMs(cfg: EnvioWhatsappConfig, rnd: number): number {
  const min = Math.max(0, cfg.jitterMinSeg) * 1000;
  const max = Math.max(min, cfg.jitterMaxSeg * 1000);
  return Math.round(min + rnd * (max - min));
}

/** Quanto o cursor de envio da empresa avança a cada mensagem (base + jitter). */
export function incrementoMs(cfg: EnvioWhatsappConfig, rnd: number): number {
  return intervaloBaseMs(cfg) + jitterMs(cfg, rnd);
}
