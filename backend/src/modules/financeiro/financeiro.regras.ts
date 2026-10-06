/**
 * Financeiro (ERP Fase 3) — regras PURAS (testadas). Dinheiro em centavos
 * inteiros pra não errar soma de decimal.
 */

export type FinStatus = 'ABERTO' | 'PARCIAL' | 'QUITADO' | 'CANCELADO';
export type Situacao = 'ABERTO' | 'VENCIDO' | 'PARCIAL' | 'QUITADO' | 'CANCELADO';

export const centavos = (v: number) => Math.round(v * 100);
export const reais = (c: number) => c / 100;

/** "AAAA-MM-DD" → 12:00 UTC (no fuso de Brasília continua o mesmo dia). */
export function dataPura(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, 12));
}

/** Hoje (Brasília) como data pura. */
export function hojePuro(agora = new Date()): Date {
  const sp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
  return dataPura(sp);
}

/** Vencimento do mês: dia 31 em fevereiro vira o último dia de fevereiro. */
export function vencimentoNoMes(ano: number, mes0: number, dia: number): Date {
  const ultimo = new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes0, Math.min(dia, ultimo), 12));
}

/** Soma `meses` a uma data pura, mantendo o dia (com o mesmo corte de mês curto). */
export function somarMeses(d: Date, meses: number, diaBase = d.getUTCDate()): Date {
  const total = d.getUTCMonth() + meses;
  return vencimentoNoMes(
    d.getUTCFullYear() + Math.floor(total / 12),
    ((total % 12) + 12) % 12,
    diaBase,
  );
}

/** Status gravado depois das baixas (o "vencido" não é gravado). */
export function statusPelasBaixas(valorC: number, pagoC: number): FinStatus {
  if (pagoC <= 0) return 'ABERTO';
  if (pagoC >= valorC) return 'QUITADO';
  return 'PARCIAL';
}

/** Situação pra tela: VENCIDO é aberto/parcial com vencimento antes de hoje. */
export function situacao(status: FinStatus, vencimento: Date, hoje: Date): Situacao {
  if ((status === 'ABERTO' || status === 'PARCIAL') && vencimento.getTime() < hoje.getTime()) {
    return 'VENCIDO';
  }
  return status;
}
