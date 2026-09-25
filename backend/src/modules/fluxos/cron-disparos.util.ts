import { proximaExecucaoCrons } from './cron.util';
import { ehFeriadoNacional } from './feriados.util';

/**
 * RASTRO dos disparos do CRON_AGENDADO (Léo, 25/09).
 *
 * Um disparo que termina sem efeito (ex.: LIBERAR_LOTE com 0 leads elegíveis)
 * tem a execução APAGADA, de propósito, pra não poluir o histórico. O efeito
 * colateral era não sobrar prova de que o robô rodou: o R2 disparou 5×/dia por
 * 17 dias sem liberar ninguém (etapa de origem vazia) e a tela mostrava o
 * "último disparo" em 08/09 e a agenda sumia com o horário depois que passava.
 *
 * Por isso o job grava, a cada slot, `{slot, execId}` numa lista capada no
 * Redis. O dashboard cruza com o banco: execução existe → o status dela;
 * execução sumiu → foi descartada por não ter nada a fazer.
 */
export const chaveDisparosCron = (fluxoId: string): string => `cron:disparos:${fluxoId}`;
/** Últimos N slots guardados por fluxo — cobre ~12 dias de um cron de 5×/dia. */
export const MAX_DISPAROS_GUARDADOS = 60;

export interface DisparoCron {
  slot: string;
  execId?: string;
  feriado?: boolean;
}

export type ResultadoSlot =
  | 'agendado'
  | 'ok'
  | 'sem_efeito'
  | 'falhou'
  | 'rodando'
  | 'cancelado'
  | 'feriado'
  | 'nao_disparou'
  | 'sem_registro';

/** "2026-09-25" no fuso dado — o "hoje" de quem agendou, não o do servidor (UTC). */
function diaNoFuso(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** 00:00 de hoje no fuso dado, como instante UTC. */
function inicioDoDiaNoFuso(d: Date, tz: string): Date {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const desdeMeiaNoite = (n('hour') * 3600 + n('minute') * 60 + n('second')) * 1000;
  return new Date(d.getTime() - desdeMeiaNoite - d.getMilliseconds());
}

/**
 * Todos os horários de HOJE (no fuso do fluxo) em que o cron bate — os que já
 * passaram e os que faltam. Capado em `max`: cron de minuto em minuto não vira
 * uma agenda de 1440 linhas.
 */
export function horariosDoDia(exprs: string[], tz: string, agora: Date, max = 24): Date[] {
  const hoje = diaNoFuso(agora, tz);
  const out: Date[] = [];
  // Começa na MEIA-NOITE de hoje no fuso — não 26h antes: um cron de minuto em
  // minuto andaria ~1.500 passos só pra chegar em hoje (lento no painel, e
  // estourava o tempo do teste com a suíte carregada).
  let apos = new Date(inicioDoDiaNoFuso(agora, tz).getTime() - 1);
  for (let i = 0; i < 2000 && out.length < max; i++) {
    const prox = proximaExecucaoCrons(exprs, tz, apos);
    if (!prox) break;
    const dia = diaNoFuso(prox, tz);
    if (dia > hoje) break;
    if (dia === hoje) out.push(prox);
    apos = prox;
  }
  return out;
}

export function lerDisparos(brutos: string[]): DisparoCron[] {
  const out: DisparoCron[] = [];
  for (const b of brutos) {
    try {
      const d = JSON.parse(b) as DisparoCron;
      if (d && typeof d.slot === 'string') out.push(d);
    } catch {
      // entrada corrompida não derruba a agenda
    }
  }
  return out;
}

/**
 * O que aconteceu num horário. `registroDesde` = o slot mais antigo gravado:
 * antes dele o rastro não existia (deploy), então a ausência NÃO acusa "não
 * disparou" — acusaria falso no dia do deploy.
 */
export function resultadoDoSlot(p: {
  slot: Date;
  agora: Date;
  tz: string;
  pularFeriados: boolean;
  disparo?: DisparoCron;
  exec?: { status: string; erroMsg: string | null } | null;
  registroDesde: Date | null;
}): { resultado: ResultadoSlot; detalhe: string } {
  const { slot, agora, disparo, exec } = p;
  if (disparo?.feriado || (p.pularFeriados && ehFeriadoNacional(slot, p.tz))) {
    return { resultado: 'feriado', detalhe: 'pulado — feriado nacional' };
  }
  if (!disparo) {
    if (slot.getTime() > agora.getTime()) return { resultado: 'agendado', detalhe: 'agendado' };
    // O job roda a cada minuto: 3 min de folga antes de acusar.
    const passou = agora.getTime() - slot.getTime() > 3 * 60_000;
    if (passou && p.registroDesde && p.registroDesde.getTime() <= slot.getTime()) {
      return { resultado: 'nao_disparou', detalhe: 'NÃO disparou — confira o worker' };
    }
    if (!passou) return { resultado: 'rodando', detalhe: 'disparando agora' };
    return { resultado: 'sem_registro', detalhe: 'sem registro' };
  }
  if (!exec) {
    // A execução sumiu: o executor descarta a do cron que terminou sem efeito.
    return { resultado: 'sem_efeito', detalhe: 'rodou — nada a fazer' };
  }
  switch (exec.status) {
    case 'CONCLUIDO':
      return { resultado: 'ok', detalhe: 'rodou ✓' };
    case 'FALHOU':
      return {
        resultado: 'falhou',
        detalhe: `falhou — ${(exec.erroMsg ?? 'erro sem mensagem').slice(0, 120)}`,
      };
    case 'CANCELADO':
      return { resultado: 'cancelado', detalhe: 'cancelado' };
    default:
      return { resultado: 'rodando', detalhe: 'rodando agora' };
  }
}
