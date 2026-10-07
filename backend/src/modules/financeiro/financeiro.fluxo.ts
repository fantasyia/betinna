/**
 * Fluxo de caixa (ERP Fase 3 · entrega C) — PURO, testado.
 *
 * Por período (dia, semana ou mês):
 *  - REALIZADO: o que entrou e saiu (baixas válidas, pela data da baixa);
 *  - PREVISTO: o que ainda falta receber/pagar e vence no período, de hoje
 *    pra frente (o que venceu antes de hoje vai pro destaque "vencidos");
 *  - SALDO PROJETADO: saldo atual das contas + previsto acumulado, a partir
 *    do período de hoje. Período que já passou não tem projeção.
 *
 * Tudo em CENTAVOS (inteiro) e datas "puras" (12:00 UTC), como o resto do
 * financeiro — sem erro de vírgula nem de fuso.
 */
import type { FinTipo } from '@prisma/client';
import { dataPura } from './financeiro.regras';

export type Agrupar = 'dia' | 'semana' | 'mes';

export interface Periodo {
  inicio: Date;
  fim: Date;
  rotulo: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const somarDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ddmm = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Começo do período que contém `d` (semana começa na segunda). */
export function inicioDoPeriodo(d: Date, agrupar: Agrupar): Date {
  if (agrupar === 'dia') return d;
  if (agrupar === 'mes') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12));
  const diaSemana = (d.getUTCDay() + 6) % 7; // segunda = 0
  return somarDias(d, -diaSemana);
}

/** Períodos que cobrem [de, ate], alinhados ao começo de cada período. */
export function periodos(de: Date, ate: Date, agrupar: Agrupar): Periodo[] {
  const out: Periodo[] = [];
  let ini = inicioDoPeriodo(de, agrupar);
  while (ini <= ate && out.length < 500) {
    let fim: Date;
    let rotulo: string;
    if (agrupar === 'dia') {
      fim = ini;
      rotulo = ddmm(ini);
    } else if (agrupar === 'semana') {
      fim = somarDias(ini, 6);
      rotulo = `${ddmm(ini)} a ${ddmm(fim)}`;
    } else {
      const prox = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 1, 12));
      fim = somarDias(prox, -1);
      rotulo = `${MESES[ini.getUTCMonth()]}/${String(ini.getUTCFullYear()).slice(2)}`;
    }
    out.push({ inicio: ini, fim, rotulo });
    ini = somarDias(fim, 1);
  }
  return out;
}

export interface EntradaFluxo {
  de: string;
  ate: string;
  agrupar: Agrupar;
  hoje: Date;
  /** Soma do saldo atual das contas (centavos). */
  saldoAtualC: number;
  /** Títulos em aberto: o que FALTA (centavos), por vencimento. */
  abertos: Array<{ tipo: FinTipo; faltaC: number; vencimento: Date }>;
  /** Baixas válidas: o que entrou/saiu (centavos), pela data. */
  movimentos: Array<{ tipo: FinTipo; valorC: number; data: Date }>;
}

export interface LinhaFluxo {
  inicio: string;
  fim: string;
  rotulo: string;
  /** O período de hoje. */
  atual: boolean;
  entrouC: number;
  saiuC: number;
  aEntrarC: number;
  aSairC: number;
  /** Saldo das contas ao fim do período, se tudo o previsto acontecer. null = já passou. */
  saldoProjetadoC: number | null;
}

export function montarFluxo(e: EntradaFluxo): {
  linhas: LinhaFluxo[];
  vencidos: { aReceberC: number; aPagarC: number };
} {
  const lista = periodos(dataPura(e.de), dataPura(e.ate), e.agrupar);
  const dentro = (d: Date, p: Periodo) => d >= p.inicio && d <= p.fim;
  let saldo = e.saldoAtualC;
  const linhas = lista.map((p) => {
    const entrouC = e.movimentos
      .filter((m) => m.tipo === 'RECEBER' && dentro(m.data, p))
      .reduce((s, m) => s + m.valorC, 0);
    const saiuC = e.movimentos
      .filter((m) => m.tipo === 'PAGAR' && dentro(m.data, p))
      .reduce((s, m) => s + m.valorC, 0);
    const futuro = (a: { vencimento: Date }) => a.vencimento >= e.hoje && dentro(a.vencimento, p);
    const aEntrarC = e.abertos
      .filter((a) => a.tipo === 'RECEBER' && futuro(a))
      .reduce((s, a) => s + a.faltaC, 0);
    const aSairC = e.abertos
      .filter((a) => a.tipo === 'PAGAR' && futuro(a))
      .reduce((s, a) => s + a.faltaC, 0);
    const passou = p.fim < e.hoje;
    if (!passou) saldo += aEntrarC - aSairC;
    return {
      inicio: iso(p.inicio),
      fim: iso(p.fim),
      rotulo: p.rotulo,
      atual: dentro(e.hoje, p),
      entrouC,
      saiuC,
      aEntrarC,
      aSairC,
      saldoProjetadoC: passou ? null : saldo,
    };
  });
  const vencido = (tipo: FinTipo) =>
    e.abertos
      .filter((a) => a.tipo === tipo && a.vencimento < e.hoje)
      .reduce((s, a) => s + a.faltaC, 0);
  return { linhas, vencidos: { aReceberC: vencido('RECEBER'), aPagarC: vencido('PAGAR') } };
}

/** Teto de períodos por agrupamento (a tela não precisa de mais, e a consulta fica leve). */
export const MAX_PERIODOS: Record<Agrupar, number> = { dia: 92, semana: 60, mes: 36 };

/** Nome do contato normalizado pra agrupar ("Facção Maria " = "facção maria"). */
export function chaveContato(nome: string | null | undefined): string {
  return (nome ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
