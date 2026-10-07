/** Financeiro (ERP Fase 3) — tipos e helpers puros da tela. */

export type Situacao = 'ABERTO' | 'VENCIDO' | 'PARCIAL' | 'QUITADO' | 'CANCELADO';

export interface Titulo {
  id: string;
  tipo: 'RECEBER' | 'PAGAR';
  descricao: string;
  valor: number;
  pago: number;
  saldo: number;
  vencimento: string;
  status: 'ABERTO' | 'PARCIAL' | 'QUITADO' | 'CANCELADO';
  situacao: Situacao;
  categoria: { id: string; nome: string } | null;
  contatoNome: string | null;
  observacoes: string | null;
  recorrente: boolean;
  automatico: boolean;
}

export interface Lista {
  titulos: Titulo[];
  totais: { emAberto: number; vencido: number; quitadoNoMes: number };
}

export interface Categoria {
  id: string;
  tipo: 'RECEBER' | 'PAGAR';
  nome: string;
  ativo: boolean;
}

export interface Conta {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  saldoInicial: number;
  saldo: number;
}

/** Hoje no fuso de Brasília, "AAAA-MM-DD". */
export function hojeIso(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

export function rotuloSituacao(
  s: Situacao,
  tipo: 'RECEBER' | 'PAGAR',
): { texto: string; tom: 'neutral' | 'danger' | 'warning' | 'success' | 'outline' } {
  switch (s) {
    case 'VENCIDO':
      return { texto: 'Vencido', tom: 'danger' };
    case 'PARCIAL':
      return { texto: tipo === 'RECEBER' ? 'Recebido em parte' : 'Pago em parte', tom: 'warning' };
    case 'QUITADO':
      return { texto: tipo === 'RECEBER' ? 'Recebido' : 'Pago', tom: 'success' };
    case 'CANCELADO':
      return { texto: 'Cancelado', tom: 'outline' };
    default:
      return { texto: 'Em aberto', tom: 'neutral' };
  }
}

// ─── Fluxo de caixa e por contato (entrega C) ─────────────────────────────

export type Agrupar = 'dia' | 'semana' | 'mes';

export interface LinhaFluxo {
  inicio: string;
  fim: string;
  rotulo: string;
  atual: boolean;
  entrou: number;
  saiu: number;
  aEntrar: number;
  aSair: number;
  saldoProjetado: number | null;
}

export interface Fluxo {
  hoje: string;
  saldoAtual: number;
  contas: Array<{ id: string; nome: string; saldo: number }>;
  vencidos: { aReceber: number; aPagar: number };
  linhas: LinhaFluxo[];
}

export interface PorContato {
  contato: string | null;
  emAberto: number;
  vencido: number;
  titulos: number;
  proximoVencimento: string | null;
}

/** "AAAA-MM-DD" + n dias (sem fuso: conta no meio-dia UTC). */
export function somarDiasIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Janela padrão de cada agrupamento: um pouco do passado e mais do futuro. */
export function intervaloPadrao(agrupar: Agrupar, hoje: string): { de: string; ate: string } {
  if (agrupar === 'dia') return { de: somarDiasIso(hoje, -7), ate: somarDiasIso(hoje, 30) };
  if (agrupar === 'semana') return { de: somarDiasIso(hoje, -28), ate: somarDiasIso(hoje, 56) };
  const [a, m] = hoje.split('-').map(Number);
  const mes = (delta: number, ultimo = false) => {
    const d = new Date(Date.UTC(a, m - 1 + delta + (ultimo ? 1 : 0), ultimo ? 0 : 1, 12));
    return d.toISOString().slice(0, 10);
  };
  return { de: mes(-2), ate: mes(5, true) };
}

/** "2026-10-20" → "20/10/2026". */
export function dataBr(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
