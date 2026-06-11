import parser from 'cron-parser';

/** Fuso padrão do sistema (BR). */
export const CRON_TZ_PADRAO = 'America/Sao_Paulo';

export interface CronPreview {
  valido: boolean;
  erro?: string;
  /** Próximas execuções: ISO (UTC) + rótulo humano no fuso escolhido. */
  proximas: Array<{ iso: string; label: string }>;
}

/** Rótulo humano pt-BR no fuso (ex: "seg., 10/06, 09:00"). */
function rotular(d: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/**
 * Valida uma expressão cron e devolve as próximas `n` execuções (humanizadas).
 * Erro inválido vira `{ valido: false, erro }` em vez de lançar — a UI mostra
 * o erro antes de salvar.
 */
export function previewCron(expressao: string, timezone = CRON_TZ_PADRAO, n = 3): CronPreview {
  const expr = (expressao ?? '').trim();
  if (!expr) return { valido: false, erro: 'Informe a expressão cron.', proximas: [] };
  try {
    const it = parser.parseExpression(expr, { tz: timezone });
    const proximas: CronPreview['proximas'] = [];
    for (let i = 0; i < n; i++) {
      const d = it.next().toDate();
      proximas.push({ iso: d.toISOString(), label: rotular(d, timezone) });
    }
    return { valido: true, proximas };
  } catch (err) {
    return {
      valido: false,
      erro: err instanceof Error ? err.message : 'Expressão cron inválida.',
      proximas: [],
    };
  }
}

/** Próxima execução depois de `apos` (pro motor de disparo). Null se inválida. */
export function proximaExecucaoCron(expressao: string, timezone: string, apos: Date): Date | null {
  const expr = (expressao ?? '').trim();
  if (!expr) return null;
  try {
    const it = parser.parseExpression(expr, { tz: timezone, currentDate: apos });
    return it.next().toDate();
  } catch {
    return null;
  }
}
