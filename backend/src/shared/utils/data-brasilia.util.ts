/**
 * Data/mês de referência no fuso de BRASÍLIA (UTC-3).
 *
 * AUDITORIA #B14: o teto de tokens por prompt virava o dia pelo relógio do
 * SERVIDOR — e o container roda em UTC. Na prática o contador zerava às 21:00 de
 * Brasília: o bot ganhava 3h de cota extra todo fim de tarde e, pior, o "dia"
 * do teto não batia com o dia do relatório de custo (que já usava BRT). Dois
 * lugares calculavam isso; agora é um só.
 *
 * Offset FIXO de -3h: o Brasil não tem mais horário de verão desde 2019.
 */
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** `YYYY-MM-DD` no fuso de Brasília. */
export function diaBrasilia(d: Date = new Date()): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM` no fuso de Brasília. */
export function mesBrasilia(d: Date = new Date()): string {
  return diaBrasilia(d).slice(0, 7);
}
