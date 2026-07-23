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
}

export interface DashboardResumo {
  pulso: PulsoResumo;
  triagem: TriagemItem[];
  prontidao: { ativo: boolean; linhas: ProntidaoLinha[] };
  fluxosSala: FluxoSalaRow[];
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
