/**
 * Helpers do gatilho "Cron agendado" — listas de timezone/dia e a montagem da
 * expressão cron a partir dos campos amigáveis do wizard. Autocontido.
 */

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

/** Monta a expressão cron a partir dos campos amigáveis do wizard. */
export function montarCron(freq: string, horario: string, dias: string[], diaMes: string): string {
  const [hh, mm] = (horario || '09:00').split(':');
  const M = String(Math.max(0, Math.min(59, parseInt(mm || '0', 10) || 0)));
  const H = String(Math.max(0, Math.min(23, parseInt(hh || '9', 10) || 9)));
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

export interface CronPreviewResp {
  valido: boolean;
  erro?: string;
  proximas: Array<{ iso: string; label: string }>;
}
