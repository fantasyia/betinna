/**
 * Aritmética de calendário no fuso de Brasília.
 *
 * Existe porque o servidor roda em UTC e QUALQUER regra de "horário comercial"
 * do app é sobre o relógio de parede do Brasil: 18h em Brasília é 21h UTC, e
 * usar `getHours()` direto no container faria a janela abrir e fechar três
 * horas erradas — sem erro, sem log, só mensagem saindo na hora que não devia.
 *
 * Extraído quando a JANELA DE ENVIO do WhatsApp precisou da mesma conta que o
 * alerta de conversa esquecida já fazia. Duas cópias da mesma matemática de
 * fuso é o tipo de coisa que só diverge no dia em que alguém corrige uma.
 */

/** O Brasil não tem mais horário de verão desde 2019 — offset fixo. */
export const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface PartesBrt {
  /** 0=domingo … 6=sábado, no fuso de Brasília. */
  diaSemana: number;
  /** Hora fracionária (ex: 14.5 = 14h30), no fuso de Brasília. */
  hora: number;
  /** Meia-noite BRT daquele dia, expressa em epoch UTC. */
  inicioDoDiaUtc: number;
}

/** Quebra um instante nas partes do calendário de Brasília. */
export function emBrt(d: Date): PartesBrt {
  const brt = new Date(d.getTime() - BRT_OFFSET_MS);
  const hora = brt.getUTCHours() + brt.getUTCMinutes() / 60 + brt.getUTCSeconds() / 3600;
  const inicioDoDiaUtc =
    Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()) + BRT_OFFSET_MS;
  return { diaSemana: brt.getUTCDay(), hora, inicioDoDiaUtc };
}

/**
 * Dia da semana (BRT) da meia-noite passada como epoch UTC. Lê ao MEIO-DIA
 * daquele dia de propósito: qualquer erro de borda de um segundo não muda o dia.
 */
export function diaSemanaDeBrt(inicioDoDiaUtc: number): number {
  return emBrt(new Date(inicioDoDiaUtc + 12 * 3600_000)).diaSemana;
}
