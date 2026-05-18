/**
 * Cliente tipado para /notificacoes endpoints.
 *
 * Já temos NotificationBell que faz polling — esse lib expõe operações
 * pra componentes que queiram interagir com notificações sem reimplementar
 * fetch + tipos.
 */
import { api } from './api';

export type NotificacaoTipo =
  | 'APROVACAO_PENDENTE'
  | 'APROVACAO_RESOLVIDA'
  | 'OCORRENCIA_ABERTA'
  | 'OCORRENCIA_RESOLVIDA'
  | 'PEDIDO_APROVADO'
  | 'COMISSAO_FECHADA'
  | 'COMISSAO_PAGA'
  | 'MENSAGEM_INBOX'
  | 'AMOSTRA_FOLLOWUP'
  | 'LEAD_INATIVO'
  | 'CLIENTE_BLOQUEADO'
  | 'ESTOQUE_ZERADO'
  | 'GENERICO';

export type NotificacaoPrioridade = 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE';

export interface Notificacao {
  id: string;
  tipo: NotificacaoTipo;
  prioridade: NotificacaoPrioridade;
  titulo: string;
  mensagem: string;
  link: string | null;
  lidaEm: string | null;
  criadoEm: string;
  metadata?: Record<string, unknown> | null;
}

export interface ListNotificacoesParams {
  page?: number;
  limit?: number;
  apenasNaoLidas?: boolean;
  tipo?: NotificacaoTipo;
  prioridade?: NotificacaoPrioridade;
}

export interface NotificacoesPage {
  data: Notificacao[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  naoLidas: number;
}

export async function listNotificacoes(
  params: ListNotificacoesParams = {},
): Promise<NotificacoesPage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.apenasNaoLidas) qs.set('apenasNaoLidas', 'true');
  if (params.tipo) qs.set('tipo', params.tipo);
  if (params.prioridade) qs.set('prioridade', params.prioridade);
  return api.get<NotificacoesPage>(`/notificacoes?${qs.toString()}`);
}

export async function contarNaoLidas(): Promise<{ naoLidas: number }> {
  return api.get<{ naoLidas: number }>('/notificacoes/nao-lidas');
}

export async function marcarComoLida(id: string): Promise<void> {
  await api.patch(`/notificacoes/${id}/ler`);
}

export async function marcarTodasComoLidas(): Promise<{ atualizadas: number }> {
  return api.patch<{ atualizadas: number }>('/notificacoes/ler-todas');
}

export async function deletarNotificacao(id: string): Promise<void> {
  await api.delete(`/notificacoes/${id}`);
}

export async function criarNotificacaoManual(params: {
  usuarioId: string;
  tipo: NotificacaoTipo;
  prioridade?: NotificacaoPrioridade;
  titulo: string;
  mensagem: string;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<Notificacao> {
  return api.post<Notificacao>('/notificacoes', params);
}
