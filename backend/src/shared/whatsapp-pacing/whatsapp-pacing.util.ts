/**
 * Pacing global de envio de WhatsApp (ConfiguracaoTenant → Empresa.config.envioWhatsapp).
 * Garante espaçamento natural (humano) entre QUALQUER mensagem outbound da empresa,
 * independente do que disparou (fluxo, campanha, resposta do bot). Funções puras.
 */

import { diaSemanaDeBrt, emBrt } from '@shared/tempo/brt.util';

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

// ═══════════════════════════════════════════════════════════════════════
// JANELA DE ENVIO (horário de silêncio)
// ═══════════════════════════════════════════════════════════════════════
//
// O pacing acima resolve RAJADA (não mandar tudo de uma vez). Não resolve
// HORÁRIO: um fluxo com DELAY de 3h disparado às 21h manda às 0h, e o `DELAY`
// do motor é cego pra relógio de parede — conta milissegundos, não sabe o que é
// madrugada.
//
// Mensagem ativa de madrugada é o padrão mais denunciável que existe (a pessoa
// acorda com o celular apitando e denuncia), e o número é o mesmo que atende o
// SAC. Por isso a janela mora AQUI, e não em cada fluxo: este é o gargalo único
// por onde passa todo outbound, então uma regra só cobre T1, C1, C2, campanhas
// e o que for criado amanhã — em vez de depender de alguém lembrar de montar
// CONDICAO + DELAY na mão em cada fluxo novo.
//
// ⚠️ Só vale pra envio PROATIVO. Responder quem acabou de escrever às 23h não é
// invasão — a pessoa está acordada e falando com você AGORA. Segurar essa
// resposta até as 8h seria um defeito, não uma proteção.

export interface JanelaEnvioConfig {
  /** Liga/desliga o silêncio noturno pro tenant. */
  ativa: boolean;
  /** Hora em que a janela ABRE (0–23), fuso de Brasília. */
  horaInicio: number;
  /** Hora em que a janela FECHA (1–24), fuso de Brasília. */
  horaFim: number;
  /** Dias em que se pode enviar (0=domingo … 6=sábado). */
  dias: number[];
}

/**
 * Padrão: 8h–20h, TODOS os dias.
 *
 * O 8h veio do Léo ("segura até as 8"). O 20h é o outro lado da mesma regra —
 * sem hora de fechar, "janela" não quer dizer nada. Todos os dias de propósito:
 * restringir a dias úteis seguraria campanha de sábado até segunda, que é uma
 * mudança de comportamento bem maior do que a pedida. Quem quiser tirar fim de
 * semana, tira na configuração.
 */
export const JANELA_ENVIO_DEFAULT: JanelaEnvioConfig = {
  ativa: true,
  horaInicio: 8,
  horaFim: 20,
  dias: [0, 1, 2, 3, 4, 5, 6],
};

export function resolveJanelaEnvio(raw: unknown): JanelaEnvioConfig {
  const c = (raw ?? {}) as Partial<JanelaEnvioConfig>;
  const dias = Array.isArray(c.dias)
    ? c.dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : JANELA_ENVIO_DEFAULT.dias;
  const inicioBruto = naFaixa(c.horaInicio, 0, 23, JANELA_ENVIO_DEFAULT.horaInicio);
  const fimBruto = naFaixa(c.horaFim, 1, 24, JANELA_ENVIO_DEFAULT.horaFim);
  // Janela invertida (fecha antes de abrir) tem duração negativa: NUNCA abriria,
  // e o outbound da empresa pararia pra sempre — falha que ninguém percebe até
  // alguém perguntar por que nenhuma campanha saiu. Corrigir só uma das pontas
  // não resolve (22h→20h continua invertido), então as DUAS voltam ao padrão.
  const invertida = fimBruto <= inicioBruto;
  return {
    ativa: typeof c.ativa === 'boolean' ? c.ativa : JANELA_ENVIO_DEFAULT.ativa,
    horaInicio: invertida ? JANELA_ENVIO_DEFAULT.horaInicio : inicioBruto,
    horaFim: invertida ? JANELA_ENVIO_DEFAULT.horaFim : fimBruto,
    dias: dias.length > 0 ? dias : JANELA_ENVIO_DEFAULT.dias,
  };
}

function naFaixa(v: unknown, min: number, max: number, padrao: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : padrao;
}

/**
 * Quantos ms faltam pra janela abrir. `0` = pode enviar agora.
 *
 * Caminha no máximo 8 dias à frente. Se não achar dia liberado nesse intervalo,
 * devolve 0 — FAIL-OPEN de propósito: config estranha tem que causar mensagem
 * fora de hora, não silêncio permanente. Silêncio permanente é o tipo de falha
 * que ninguém percebe até o cliente perguntar por que nunca recebeu nada.
 */
export function esperaAteJanelaMs(cfg: JanelaEnvioConfig, agora: Date): number {
  if (!cfg.ativa) return 0;
  const permitidos = new Set(cfg.dias);
  const t = agora.getTime();
  let cursor = emBrt(agora).inicioDoDiaUtc;
  for (let i = 0; i < 8; i++) {
    if (permitidos.has(diaSemanaDeBrt(cursor))) {
      const abre = cursor + cfg.horaInicio * 3600_000;
      const fecha = cursor + cfg.horaFim * 3600_000;
      if (t >= abre && t < fecha) return 0;
      if (t < abre) return abre - t;
    }
    cursor += 24 * 3600_000;
  }
  return 0;
}

/**
 * Erro levantado pelo pacing quando um envio PROATIVO cai fora da janela.
 *
 * É erro, e não um `return` silencioso, porque a alternativa é pior: um ponto de
 * envio novo que esqueça de checar a janela mandaria de madrugada sem ninguém
 * notar. Assim ele quebra alto na primeira vez, e quem escreveu decide como
 * reagendar. Quem já sabe lidar (fluxos, campanhas) checa ANTES e nem chega aqui.
 */
export class ForaDaJanelaEnvioError extends Error {
  constructor(
    readonly esperaMs: number,
    readonly retomarEm: Date,
  ) {
    super(
      `Fora da janela de envio: envio proativo retomável em ${retomarEm.toISOString()} ` +
        `(${Math.round(esperaMs / 60000)} min).`,
    );
    this.name = 'ForaDaJanelaEnvioError';
  }
}
