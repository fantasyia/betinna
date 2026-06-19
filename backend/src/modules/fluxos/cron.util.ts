import parser from 'cron-parser';
import { ehFeriadoNacional } from './feriados.util';

/** Fuso padrão do sistema (BR). */
export const CRON_TZ_PADRAO = 'America/Sao_Paulo';

export interface CronPreview {
  valido: boolean;
  erro?: string;
  /** Próximas execuções: ISO (UTC) + rótulo humano no fuso escolhido. */
  proximas: Array<{ iso: string; label: string }>;
}

/**
 * Valida que a expressão tem EXATAMENTE 5 campos (min hora dia mês dia-semana).
 *
 * `cron-parser` é leniente: aceita 1–6 campos (o 6º/1º vira segundos). Então "2"
 * é aceito como "no segundo 2 de todo minuto" — bug de UX (preview 00:00/00:01/...).
 * Travamos o formato padrão de 5 campos ANTES de delegar pro parser.
 */
export function validarCronExpr(expressao: string): { valido: boolean; erro?: string } {
  const expr = (expressao ?? '').trim();
  if (!expr) return { valido: false, erro: 'Informe a expressão cron.' };
  const campos = expr.split(/\s+/);
  if (campos.length !== 5) {
    return {
      valido: false,
      erro: `A expressão precisa ter 5 campos (min hora dia mês dia-semana) — você informou ${campos.length}.`,
    };
  }
  try {
    parser.parseExpression(expr, { tz: CRON_TZ_PADRAO });
    return { valido: true };
  } catch (err) {
    return { valido: false, erro: err instanceof Error ? err.message : 'Expressão cron inválida.' };
  }
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
 * Valida UMA expressão e devolve as próximas `n` execuções (humanizadas).
 * Back-compat: delega pra `previewCrons` com um array de 1.
 */
export function previewCron(expressao: string, timezone = CRON_TZ_PADRAO, n = 5): CronPreview {
  return previewCrons([expressao], timezone, n);
}

/**
 * Valida VÁRIAS expressões e funde as próximas `n` execuções de todas — ordenadas
 * cronologicamente, sem instantes duplicados, cortadas em `n`. Uma expressão
 * inválida invalida o conjunto (a UI mostra o erro antes de salvar). Quando
 * `pularFeriados`, descarta as datas que caem em feriado nacional (a preview
 * reflete o que o motor de disparo vai fazer).
 */
export function previewCrons(
  expressoes: string[],
  timezone = CRON_TZ_PADRAO,
  n = 5,
  pularFeriados = false,
): CronPreview {
  const exprs = (expressoes ?? []).map((e) => (e ?? '').trim()).filter(Boolean);
  if (exprs.length === 0) {
    return { valido: false, erro: 'Informe a expressão cron.', proximas: [] };
  }
  for (const e of exprs) {
    const v = validarCronExpr(e);
    if (!v.valido) return { valido: false, erro: v.erro, proximas: [] };
  }
  const todas: Array<{ iso: string; label: string; ts: number }> = [];
  for (const e of exprs) {
    try {
      const it = parser.parseExpression(e, { tz: timezone });
      let coletadas = 0;
      let iteracoes = 0;
      // Cap defensivo: evita loop infinito se filtrar feriados nunca juntar `n`.
      while (coletadas < n && iteracoes < 2000) {
        iteracoes++;
        const d = it.next().toDate();
        if (pularFeriados && ehFeriadoNacional(d, timezone)) continue;
        todas.push({ iso: d.toISOString(), label: rotular(d, timezone), ts: d.getTime() });
        coletadas++;
      }
    } catch {
      // já validado acima — ramo defensivo.
    }
  }
  const vistos = new Set<number>();
  const proximas = todas
    .sort((a, b) => a.ts - b.ts)
    .filter((x) => (vistos.has(x.ts) ? false : (vistos.add(x.ts), true)))
    .slice(0, n)
    .map((x) => ({ iso: x.iso, label: x.label }));
  return { valido: true, proximas };
}

/** Próxima execução depois de `apos` (back-compat, 1 expressão). Null se inválida. */
export function proximaExecucaoCron(expressao: string, timezone: string, apos: Date): Date | null {
  return proximaExecucaoCrons([expressao], timezone, apos);
}

/**
 * Próxima execução (a MAIS CEDO entre todas as expressões) depois de `apos`.
 * Pro motor de disparo com múltiplos horários/regras no mesmo gatilho.
 */
export function proximaExecucaoCrons(
  expressoes: string[],
  timezone: string,
  apos: Date,
): Date | null {
  const exprs = (expressoes ?? []).map((e) => (e ?? '').trim()).filter(Boolean);
  let menor: Date | null = null;
  for (const e of exprs) {
    if (!validarCronExpr(e).valido) continue;
    try {
      const it = parser.parseExpression(e, { tz: timezone, currentDate: apos });
      const prox = it.next().toDate();
      if (!menor || prox.getTime() < menor.getTime()) menor = prox;
    } catch {
      // ignora — expressão isolada inválida não derruba as outras.
    }
  }
  return menor;
}
