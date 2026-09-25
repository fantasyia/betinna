/** Contrato do endpoint ÚNICO de agregação GET /dashboard/resumo. */

export interface PulsoResumo {
  leadsNovos7d: number;
  leadsSlaEstourado: number;
  fluxos: { ativos: number; total: number };
  execucoes24h: { ok: number; erro: number };
  nutrirPendentes: number;
  tarefasHoje: number;
}

export interface TriagemItem {
  tipo: 'sla' | 'parado' | 'fluxo_falha' | 'card_atrasado' | 'nutrir';
  titulo: string;
  motivo: string;
  desde: string | null;
  link: string;
  urgencia: number;
}

export interface ProntidaoLinha {
  texto: string;
  proximoPasso: string;
  link: string;
}

export interface FluxoSalaRow {
  id: string;
  nome: string;
  status: 'RASCUNHO' | 'ATIVO' | 'PAUSADO';
  triggerTipo: string | null;
  exec7d: { ok: number; erro: number; total: number; serie: number[] };
  pctSucesso: number | null;
  ultimoErro: string | null;
  proximoDisparo: string | null;
  /** Última execução de PRODUÇÃO (sinal de vida — pedido do Léo 21/08).
   *  null = nunca disparou. `status` colore a célula (ok/falha/em andamento). */
  ultimoDisparo: { em: string; status: string } | null;
}

export type ResultadoSlot =
  | 'agendado'
  | 'ok'
  | 'sem_efeito'
  | 'falhou'
  | 'rodando'
  | 'cancelado'
  | 'feriado'
  | 'nao_disparou'
  | 'sem_registro';

export interface AgendaHojeItem {
  hora: string;
  titulo: string;
  tipo: 'compromisso' | 'robo';
  detalhe: string | null;
  link: string;
  /** Só robô: o que aconteceu naquele horário (ou "agendado"). */
  resultado?: ResultadoSlot;
}

/** Execução que falhou nas últimas 72h — uma por linha, pra tratar rápido. */
export interface FalhaRecente {
  id: string;
  fluxoId: string;
  fluxoNome: string;
  erro: string;
  em: string;
  link: string;
}

export interface MensagemInterna {
  id: string;
  autorNome: string;
  cardId: string;
  cardTitulo: string;
  boardId: string;
  texto: string;
  criadoEm: string;
  mencionaMim: boolean;
}

export interface DashboardResumo {
  pulso: PulsoResumo;
  triagem: TriagemItem[];
  prontidao: { ativo: boolean; linhas: ProntidaoLinha[] };
  fluxosSala: FluxoSalaRow[];
  agendaHoje: AgendaHojeItem[];
  mensagens: MensagemInterna[];
  falhas72h?: FalhaRecente[];
}

/** "há 3d" / "há 5h" / "agora" — curto de propósito (densidade do cockpit). */
export function tempoDesde(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'agora';
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
