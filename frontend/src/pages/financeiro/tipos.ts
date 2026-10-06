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
