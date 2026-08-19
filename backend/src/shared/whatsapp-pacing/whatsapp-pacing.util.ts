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

/**
 * Quanto tempo depois da última mensagem DO LEAD a conversa ainda conta como
 * viva — e portanto o que o fluxo manda é resposta, não abordagem.
 *
 * Mora aqui junto das outras regras de envio pra a TELA poder mostrar o mesmo
 * número que o motor aplica (o executor importa esta constante).
 */
export const INBOUND_RECENTE_HORAS = 4;

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

// ═══════════════════════════════════════════════════════════════════════
// TETO DIÁRIO DE ENVIO PROATIVO
// ═══════════════════════════════════════════════════════════════════════
//
// A janela de horário e o teto diário protegem contra coisas DIFERENTES, e é
// por isso que os dois precisam existir. O ritmo (12/min) impede rajada; a
// janela impede madrugada. Nenhum dos dois impede VOLUME: 12/min dentro de uma
// janela de 12 horas dá 8.640 mensagens num dia, e é volume acumulado com taxa
// de bloqueio que derruba número pareado — não pico por minuto.
//
// O teto não existe pra ritmar a operação normal. Existe pro acidente: fluxo
// com laço, importação torta, campanha com filtro errado transformando 30 mil
// contatos em disparo. É a diferença entre "número banido" e "log com 200
// adiados" — e o número é ponto único de falha de T1, C1, C2 e da família S.

/** Teto diário de envios PROATIVOS por empresa. 0 = sem teto. */
export interface TetoDiarioConfig {
  ativo: boolean;
  maxPorDia: number;
}

/**
 * Padrão: 500/dia.
 *
 * Conservador de propósito, e bem abaixo do que o ritmo permitiria (8.640).
 * Uma campanha de 3.000 reps leva 6 dias em vez de sair num pico — e essa é a
 * forma segura de fazer num número pareado (Baileys/Evolution não tem template
 * nem janela de 24h pra proteger). Como estourar ADIA em vez de descartar,
 * teto baixo demais atrasa; teto alto demais é o que não dá pra desfazer.
 */
export const TETO_DIARIO_DEFAULT: TetoDiarioConfig = { ativo: true, maxPorDia: 500 };

export function resolveTetoDiario(raw: unknown): TetoDiarioConfig {
  const c = (raw ?? {}) as Partial<TetoDiarioConfig>;
  const max = naFaixa(c.maxPorDia, 1, 100_000, TETO_DIARIO_DEFAULT.maxPorDia);
  return {
    ativo: typeof c.ativo === 'boolean' ? c.ativo : TETO_DIARIO_DEFAULT.ativo,
    maxPorDia: max,
  };
}

/** Chave do contador diário — a data é a de BRASÍLIA, igual à janela. */
export function chaveTetoDiario(empresaId: string, agora: Date): string {
  const meiaNoite = new Date(emBrt(agora).inicioDoDiaUtc + 12 * 3600_000);
  const dia = meiaNoite.toISOString().slice(0, 10);
  return `wa:dia:${empresaId}:${dia}`;
}

/**
 * Quanto falta até o PRÓXIMO dia em que se pode enviar — usado quando o teto do
 * dia estourou. Começa a busca amanhã de propósito: o contador só zera na
 * virada da data de Brasília, então esperar a reabertura de hoje não adiantaria.
 *
 * Com a janela desligada, o que interessa é só a virada do dia (meia-noite BRT).
 */
export function esperaAteProximoDiaMs(cfg: JanelaEnvioConfig, agora: Date): number {
  const t = agora.getTime();
  let cursor = emBrt(agora).inicioDoDiaUtc + 24 * 3600_000;
  for (let i = 0; i < 8; i++) {
    if (!cfg.ativa) return cursor - t;
    if (new Set(cfg.dias).has(diaSemanaDeBrt(cursor))) {
      return cursor + cfg.horaInicio * 3600_000 - t;
    }
    cursor += 24 * 3600_000;
  }
  // Fail-open igual ao da janela: 24h em vez de silêncio permanente.
  return 24 * 3600_000;
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
    /** `horario` = fora da janela; `teto_diario` = a cota do dia acabou. */
    readonly motivo: 'horario' | 'teto_diario' = 'horario',
  ) {
    super(
      `${motivo === 'teto_diario' ? 'Teto diário de envio proativo atingido' : 'Fora da janela de envio'}: ` +
        `retomável em ${retomarEm.toISOString()} (${Math.round(esperaMs / 60000)} min).`,
    );
    this.name = 'ForaDaJanelaEnvioError';
  }
}
