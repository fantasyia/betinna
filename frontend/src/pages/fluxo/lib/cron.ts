/**
 * Helpers do gatilho "Cron agendado" — listas de timezone/dia, montagem das
 * expressões cron a partir dos campos amigáveis do wizard e tradução humana.
 * Autocontido.
 */
import cronstrue from 'cronstrue/i18n';

// ─── Cron agendado (SPEC 1) ──────────────────────────────────────

export const CRON_TIMEZONES: Array<{ v: string; l: string }> = [
  { v: 'America/Sao_Paulo', l: 'São Paulo (BRT)' },
  { v: 'America/Manaus', l: 'Manaus (AMT)' },
  { v: 'America/Cuiaba', l: 'Cuiabá' },
  { v: 'America/Rio_Branco', l: 'Rio Branco (ACT)' },
  { v: 'America/Belem', l: 'Belém' },
  { v: 'UTC', l: 'UTC' },
];

export const CRON_DIAS: Array<{ v: string; l: string }> = [
  { v: '1', l: 'Seg' },
  { v: '2', l: 'Ter' },
  { v: '3', l: 'Qua' },
  { v: '4', l: 'Qui' },
  { v: '5', l: 'Sex' },
  { v: '6', l: 'Sáb' },
  { v: '0', l: 'Dom' },
];

/** Presets de "em quais dias" pra janela/intervalo. */
export const CRON_PRESET_DIAS: Array<{ v: string; l: string }> = [
  { v: 'dias_uteis', l: 'Dias úteis (seg–sex)' },
  { v: 'todos', l: 'Todos os dias' },
  { v: 'fim_de_semana', l: 'Fim de semana' },
];

// ─── Helpers internos ────────────────────────────────────────────

function mmDe(horario: string): string {
  const [, m] = (horario || '09:00').split(':');
  return String(Math.max(0, Math.min(59, parseInt(m || '0', 10) || 0)));
}
function hhDe(horario: string): string {
  const [h] = (horario || '09:00').split(':');
  return String(Math.max(0, Math.min(23, parseInt(h || '9', 10) || 9)));
}
function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
function dowPreset(preset?: string): string {
  if (preset === 'dias_uteis') return '1-5';
  if (preset === 'fim_de_semana') return '0,6';
  return '*'; // 'todos'
}
function dedup(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

// ─── Montagem (modo simples) ─────────────────────────────────────

/**
 * Monta UMA expressão cron (frequências clássicas — back-compat). Mantida pros
 * callers/testes antigos; o wizard novo usa `montarCrons` (array).
 */
export function montarCron(freq: string, horario: string, dias: string[], diaMes: string): string {
  const M = mmDe(horario);
  const H = hhDe(horario);
  switch (freq) {
    case 'dias_uteis':
      return `${M} ${H} * * 1-5`;
    case 'fim_de_semana':
      return `${M} ${H} * * 0,6`;
    case 'dias_especificos':
      return `${M} ${H} * * ${(dias.length ? dias : ['1']).join(',')}`;
    case 'dia_do_mes':
      return `${M} ${H} ${diaMes || '1'} * *`;
    case 'todo_dia':
    default:
      return `${M} ${H} * * *`;
  }
}

/** Shape (parcial) do config do wizard cron lido por `montarCrons`. */
export interface CronWizardCfg {
  cronFreq?: string;
  cronHorarios?: string[];
  cronHorario?: string; // legado (1 horário)
  cronDias?: string[];
  cronDiaMes?: string;
  cronIntervaloN?: number | string;
  cronJanelaInicio?: string;
  cronJanelaFim?: string;
  cronJanelaUnidade?: string; // 'min' | 'horas'
  cronJanelaDias?: string; // preset
}

/** Lê os horários do config (múltiplos), com fallback pro legado de 1 horário. */
export function lerHorarios(cfg: CronWizardCfg): string[] {
  if (cfg.cronHorarios && cfg.cronHorarios.length) return cfg.cronHorarios;
  if (cfg.cronHorario) return [cfg.cronHorario];
  return ['09:00'];
}

/**
 * Monta a(s) expressão(ões) cron a partir do config do wizard. Retorna um ARRAY
 * (múltiplos horários geram uma expressão cada). Frequências:
 *  - todo_dia / dias_uteis / fim_de_semana / dias_especificos / dia_do_mes:
 *    uma expressão por horário escolhido.
 *  - cada_n_min / cada_n_horas: intervalo simples (dia inteiro, todo dia).
 *  - intervalo: a cada N (min/horas) dentro de uma janela de horário + dias.
 */
export function montarCrons(cfg: CronWizardCfg): string[] {
  const freq = cfg.cronFreq ?? 'dias_uteis';
  const horarios = lerHorarios(cfg);
  const dias = cfg.cronDias && cfg.cronDias.length ? cfg.cronDias : ['1'];
  const diaMes = String(cfg.cronDiaMes || '1');

  switch (freq) {
    case 'cada_n_min': {
      const n = clampInt(cfg.cronIntervaloN, 1, 59, 15);
      return [`*/${n} * * * *`];
    }
    case 'cada_n_horas': {
      const n = clampInt(cfg.cronIntervaloN, 1, 23, 1);
      return [`0 */${n} * * *`];
    }
    case 'intervalo': {
      const ini = clampInt(cfg.cronJanelaInicio, 0, 23, 9);
      const fim = clampInt(cfg.cronJanelaFim, 0, 23, 18);
      const lo = Math.min(ini, fim);
      const hi = Math.max(ini, fim);
      const dow = dowPreset(cfg.cronJanelaDias ?? 'dias_uteis');
      if (cfg.cronJanelaUnidade === 'horas') {
        const n = clampInt(cfg.cronIntervaloN, 1, 23, 1);
        return [`0 ${lo}-${hi}/${n} * * ${dow}`];
      }
      const n = clampInt(cfg.cronIntervaloN, 1, 59, 30);
      return [`*/${n} ${lo}-${hi} * * ${dow}`];
    }
    case 'dia_do_mes':
      return dedup(horarios.map((h) => `${mmDe(h)} ${hhDe(h)} ${diaMes} * *`));
    case 'dias_especificos':
      return dedup(horarios.map((h) => `${mmDe(h)} ${hhDe(h)} * * ${dias.join(',')}`));
    case 'dias_uteis':
      return dedup(horarios.map((h) => `${mmDe(h)} ${hhDe(h)} * * 1-5`));
    case 'fim_de_semana':
      return dedup(horarios.map((h) => `${mmDe(h)} ${hhDe(h)} * * 0,6`));
    case 'todo_dia':
    default:
      return dedup(horarios.map((h) => `${mmDe(h)} ${hhDe(h)} * * *`));
  }
}

/**
 * Traduz expressão(ões) cron pra linguagem humana (pt-BR). Junta múltiplas com
 * " · ". Retorna '' se nenhuma for válida (a UI mostra o erro do preview).
 */
export function traduzirCrons(expressoes: string[]): string {
  const partes = expressoes
    .map((e) => {
      const expr = (e ?? '').trim();
      if (!expr || expr.split(/\s+/).length !== 5) return null;
      try {
        return cronstrue.toString(expr, { locale: 'pt_BR', use24HourTimeFormat: true });
      } catch {
        return null;
      }
    })
    .filter((s): s is string => Boolean(s));
  return partes.join(' · ');
}

// ─── Templates prontos ───────────────────────────────────────────

/** Atalhos que pré-preenchem o wizard (config patch) com regras comuns. */
export const CRON_TEMPLATES: Array<{ l: string; cfg: Partial<CronWizardCfg> }> = [
  { l: 'Diário 9h', cfg: { cronFreq: 'todo_dia', cronHorarios: ['09:00'] } },
  { l: 'Dias úteis 9h', cfg: { cronFreq: 'dias_uteis', cronHorarios: ['09:00'] } },
  { l: 'Dias úteis 9h e 14h', cfg: { cronFreq: 'dias_uteis', cronHorarios: ['09:00', '14:00'] } },
  { l: 'Toda hora cheia', cfg: { cronFreq: 'cada_n_horas', cronIntervaloN: 1 } },
  { l: 'A cada 30min (comercial)', cfg: {
    cronFreq: 'intervalo', cronIntervaloN: 30, cronJanelaUnidade: 'min',
    cronJanelaInicio: '9', cronJanelaFim: '18', cronJanelaDias: 'dias_uteis',
  } },
  { l: 'Toda segunda 10h', cfg: { cronFreq: 'dias_especificos', cronDias: ['1'], cronHorarios: ['10:00'] } },
  { l: 'Todo dia 1º 8h', cfg: { cronFreq: 'dia_do_mes', cronDiaMes: '1', cronHorarios: ['08:00'] } },
];

export interface CronPreviewResp {
  valido: boolean;
  erro?: string;
  proximas: Array<{ iso: string; label: string }>;
}
