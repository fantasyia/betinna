/**
 * Alerta de CONVERSA ESQUECIDA — regra e contagem de horas comerciais.
 *
 * Contexto (card 🔔): depois de uma transferência pra humano, o bot NÃO volta
 * sozinho — quem religa é o atendente. Isso resolve o atropelo do bot no meio do
 * atendimento, mas cria um buraco novo: se o atendente esquecer de religar, a
 * conversa fica MUDA. Nem bot, nem humano. O cliente escreve e não responde
 * ninguém, e não existe erro em lugar nenhum pra alguém perceber.
 *
 * POR QUE HORÁRIO COMERCIAL, e não relógio de parede: 4h corridas a partir das
 * 17h cairiam às 21h — e às 21h ninguém esqueceu de nada, o expediente acabou.
 * O alarme dispararia toda noite, todo fim de semana, e em duas semanas viraria
 * ruído que ninguém olha. Contando só dentro do expediente, "4 horas" quer dizer
 * 4 horas em que alguém PODERIA ter respondido — antes disso é atendimento em
 * andamento; depois disso é esquecimento.
 */

export interface AlertaEsquecidaConfig {
  /** Liga/desliga a varredura pro tenant. */
  ativo: boolean;
  /** Horas COMERCIAIS sem resposta humana até virar alerta. */
  horas: number;
  /** Dias úteis (0=domingo … 6=sábado). */
  dias: number[];
  /** Hora de início do expediente (0–23), fuso de Brasília. */
  horaInicio: number;
  /** Hora de fim do expediente (1–24), fuso de Brasília. */
  horaFim: number;
}

/** Padrão combinado com o Léo: 4h comerciais, seg–sex, 8h–18h. */
export const ALERTA_ESQUECIDA_DEFAULT: AlertaEsquecidaConfig = {
  ativo: true,
  horas: 4,
  dias: [1, 2, 3, 4, 5],
  horaInicio: 8,
  horaFim: 18,
};

/** O Brasil não tem mais horário de verão desde 2019 — offset fixo. */
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Resolve a config do tenant sobre o default (aceita parcial e lixo). */
export function resolveAlertaEsquecida(raw: unknown): AlertaEsquecidaConfig {
  const c = (raw ?? {}) as Partial<AlertaEsquecidaConfig>;
  const dias =
    Array.isArray(c.dias) && c.dias.length > 0
      ? c.dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : ALERTA_ESQUECIDA_DEFAULT.dias;
  const horaInicio = numeroNaFaixa(c.horaInicio, 0, 23, ALERTA_ESQUECIDA_DEFAULT.horaInicio);
  const horaFimBruta = numeroNaFaixa(c.horaFim, 1, 24, ALERTA_ESQUECIDA_DEFAULT.horaFim);
  return {
    ativo: typeof c.ativo === 'boolean' ? c.ativo : ALERTA_ESQUECIDA_DEFAULT.ativo,
    horas: numeroNaFaixa(c.horas, 1, 240, ALERTA_ESQUECIDA_DEFAULT.horas),
    dias: dias.length > 0 ? dias : ALERTA_ESQUECIDA_DEFAULT.dias,
    horaInicio,
    // Janela invertida (fim <= início) não existe — cai no default em vez de
    // gerar expediente de duração negativa (que nunca venceria o prazo).
    horaFim: horaFimBruta > horaInicio ? horaFimBruta : ALERTA_ESQUECIDA_DEFAULT.horaFim,
  };
}

function numeroNaFaixa(v: unknown, min: number, max: number, padrao: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : padrao;
}

/** Partes da data no fuso de Brasília (dia da semana + hora fracionária). */
function emBrt(d: Date): { diaSemana: number; hora: number; inicioDoDiaUtc: number } {
  const brt = new Date(d.getTime() - BRT_OFFSET_MS);
  const hora = brt.getUTCHours() + brt.getUTCMinutes() / 60 + brt.getUTCSeconds() / 3600;
  // Meia-noite BRT daquele dia, expressa em epoch UTC.
  const inicioDoDiaUtc =
    Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()) + BRT_OFFSET_MS;
  return { diaSemana: brt.getUTCDay(), hora, inicioDoDiaUtc };
}

/**
 * Quantas horas COMERCIAIS se passaram entre `inicio` e `fim`.
 *
 * Caminha dia a dia (a janela real é de horas, então o laço é curto) somando só
 * a interseção de cada expediente com o intervalo. Teto de 400 dias pra nunca
 * virar laço infinito se alguém passar datas absurdas.
 */
export function horasComerciaisEntre(
  inicio: Date,
  fim: Date,
  cfg: AlertaEsquecidaConfig = ALERTA_ESQUECIDA_DEFAULT,
): number {
  if (fim <= inicio) return 0;
  const diasUteis = new Set(cfg.dias);
  let total = 0;
  let cursor = emBrt(inicio).inicioDoDiaUtc;
  const limite = fim.getTime();
  for (let i = 0; i < 400 && cursor < limite; i++) {
    const { diaSemana } = emBrt(new Date(cursor + 12 * 3600_000)); // meio-dia: imune a borda
    if (diasUteis.has(diaSemana)) {
      const abre = cursor + cfg.horaInicio * 3600_000;
      const fecha = cursor + cfg.horaFim * 3600_000;
      const de = Math.max(abre, inicio.getTime());
      const ate = Math.min(fecha, limite);
      if (ate > de) total += (ate - de) / 3600_000;
    }
    cursor += 24 * 3600_000;
  }
  return total;
}

/** A conversa já passou do prazo de horas comerciais sem resposta? */
export function passouDoPrazo(
  ultimaMensagem: Date,
  agora: Date,
  cfg: AlertaEsquecidaConfig = ALERTA_ESQUECIDA_DEFAULT,
): boolean {
  return horasComerciaisEntre(ultimaMensagem, agora, cfg) >= cfg.horas;
}
