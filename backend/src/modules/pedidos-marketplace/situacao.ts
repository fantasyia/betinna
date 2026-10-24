/**
 * Situação do pedido de marketplace, igual pra todos os canais (Léo, 24/10):
 * a enviar, enviado, entregue, cancelado, em devolução (+ aguardando pagamento,
 * que não é nenhuma das cinco). Cada canal fala a sua língua; aqui vira uma. PURO.
 */
export type Situacao =
  | 'AGUARDANDO_PAGAMENTO'
  | 'A_ENVIAR'
  | 'ENVIADO'
  | 'ENTREGUE'
  | 'CANCELADO'
  | 'EM_DEVOLUCAO';

export const SITUACOES: Situacao[] = [
  'A_ENVIAR',
  'ENVIADO',
  'ENTREGUE',
  'CANCELADO',
  'EM_DEVOLUCAO',
  'AGUARDANDO_PAGAMENTO',
];

/** Shopee: order_status. */
export function situacaoShopee(status: string): Situacao {
  switch (status) {
    case 'UNPAID':
      return 'AGUARDANDO_PAGAMENTO';
    case 'SHIPPED':
    case 'TO_CONFIRM_RECEIVE':
      return 'ENVIADO';
    case 'COMPLETED':
      return 'ENTREGUE';
    case 'IN_CANCEL':
    case 'CANCELLED':
      return 'CANCELADO';
    case 'TO_RETURN':
      return 'EM_DEVOLUCAO';
    default:
      // READY_TO_SHIP, PROCESSED, RETRY_SHIP…
      return 'A_ENVIAR';
  }
}

/** Mercado Livre: status do pedido + status do envio (shipment). */
export function situacaoMl(status: string, envio: string | null | undefined): Situacao {
  if (status === 'cancelled' || status === 'invalid') return 'CANCELADO';
  if (status === 'payment_required' || status === 'payment_in_process')
    return 'AGUARDANDO_PAGAMENTO';
  switch (envio) {
    case 'shipped':
      return 'ENVIADO';
    case 'delivered':
      return 'ENTREGUE';
    case 'not_delivered':
    case 'returned':
      return 'EM_DEVOLUCAO';
    case 'cancelled':
      return 'CANCELADO';
    default:
      // pending, handling, ready_to_ship ou ainda sem envio
      return 'A_ENVIAR';
  }
}
