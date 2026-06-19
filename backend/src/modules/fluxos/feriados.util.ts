/**
 * Feriados nacionais (BR) pro gatilho "Cron agendado" — opção "pular feriados".
 *
 * Cobre os feriados federais fixos + os móveis baseados na Páscoa (Sexta-feira
 * Santa, Carnaval seg/ter, Corpus Christi — relevantes pra "feriado bancário").
 * NÃO cobre feriados estaduais/municipais (fora de escopo).
 */

/** Páscoa (domingo) do ano — algoritmo de Computus (Gregoriano anônimo). */
function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3=março, 4=abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function mmddDe(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${m}-${dd}`;
}

function addDias(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const cache = new Map<number, Set<string>>();

/** Conjunto de 'MM-DD' dos feriados nacionais do ano (fixos + móveis). */
export function feriadosNacionaisDoAno(ano: number): Set<string> {
  const cached = cache.get(ano);
  if (cached) return cached;

  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'];
  // Consciência Negra virou feriado NACIONAL a partir de 2024 (Lei 14.759/2023).
  if (ano >= 2024) fixos.push('11-20');

  const pascoa = calcularPascoa(ano);
  const moveis = [
    addDias(pascoa, -2), // Sexta-feira Santa
    addDias(pascoa, -48), // Carnaval (segunda)
    addDias(pascoa, -47), // Carnaval (terça)
    addDias(pascoa, 60), // Corpus Christi
  ].map(mmddDe);

  const set = new Set([...fixos, ...moveis]);
  cache.set(ano, set);
  return set;
}

/** Ano + 'MM-DD' da data NO FUSO informado (não no UTC). */
function ymdNoFuso(date: Date, timezone: string): { ano: number; mmdd: string } {
  // en-CA formata como 'YYYY-MM-DD'.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [ano, mes, dia] = partes.split('-');
  return { ano: Number(ano), mmdd: `${mes}-${dia}` };
}

/** `true` se a data (no fuso) cai num feriado nacional brasileiro. */
export function ehFeriadoNacional(date: Date, timezone: string): boolean {
  const { ano, mmdd } = ymdNoFuso(date, timezone);
  return feriadosNacionaisDoAno(ano).has(mmdd);
}
