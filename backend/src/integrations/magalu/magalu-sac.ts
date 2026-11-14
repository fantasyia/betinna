import type { MarketplaceIncidentStatus, MarketplaceIncidentTipo } from '@prisma/client';
import type { IncidenteEntranteParams } from '@modules/incidents/incidents.types';
import type { MagaluTicket } from './magalu.types';

/**
 * Ticket do SAC do Magalu (GET /seller/v0/tickets) → MarketplaceIncident
 * (canal MARKETPLACE_MAGALU), SÓ LEITURA (14/11). PURO.
 */

const MOTIVOS_DEVOLUCAO = new Set([
  'incorrect_product',
  'damaged_parts',
  'missing_parts',
  'missing_damaged_parts',
  'defective_product',
  'quality_concern',
  'change_of_mind',
  'customer_error',
]);

const TIPO_PT: Record<string, string> = {
  shipping: 'Entrega',
  cancellation: 'Cancelamento',
  payment: 'Pagamento',
  general: 'Geral',
  exchange: 'Troca/devolução',
  product_question: 'Dúvida de produto',
  feedback: 'Feedback',
  shipping_notification: 'Aviso de entrega',
};

export function tipoTicket(t: Pick<MagaluTicket, 'type' | 'reason'>): MarketplaceIncidentTipo {
  if (t.reason === 'chargeback') return 'DISPUTA';
  if (t.type === 'cancellation') return 'CANCELAMENTO';
  if (t.type === 'exchange' || (t.reason && MOTIVOS_DEVOLUCAO.has(t.reason))) return 'DEVOLUCAO';
  return 'RECLAMACAO';
}

export function statusTicket(
  t: Pick<MagaluTicket, 'status' | 'closed'>,
): MarketplaceIncidentStatus {
  const s = (t.status ?? '').toLowerCase();
  if (t.closed || s === 'closed' || s === 'reversal_made') return 'RESOLVIDO';
  if (s === 'waiting_marketplace') return 'EM_MEDIACAO';
  if (s.startsWith('waiting_seller')) return 'AGUARDANDO_VENDEDOR';
  if (
    s.startsWith('waiting_customer') ||
    s.startsWith('waiting_rating') ||
    ['waiting_banking_account', 'waiting_return_info', 'waiting_item_return'].includes(s)
  ) {
    return 'AGUARDANDO_COMPRADOR';
  }
  return 'ABERTO';
}

/** Parâmetros do incidente (sem conversa: o SAC fica só leitura por enquanto). */
export function incidenteDoTicket(empresaId: string, t: MagaluTicket): IncidenteEntranteParams {
  const tipoPt = TIPO_PT[t.type ?? ''] ?? t.type ?? 'SAC';
  const protocolo = t.protocol ?? t.code ?? t.id;
  const resumo = [`SAC Magalu ${protocolo}`, tipoPt, t.reason, t.status]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 280);
  const prazo = t.due_date ? new Date(t.due_date) : undefined;
  return {
    empresaId,
    canal: 'MARKETPLACE_MAGALU',
    externalId: t.id,
    tipo: tipoTicket(t),
    status: statusTicket(t),
    motivo: [tipoPt, t.reason].filter(Boolean).join(' — ') || undefined,
    motivoCodigo: t.reason ?? undefined,
    pedidoExternoId: t.order?.code ?? undefined,
    prazoResposta: prazo && !Number.isNaN(prazo.getTime()) ? prazo : undefined,
    resumo,
    metadata: { magalu_ticket: t },
  };
}
