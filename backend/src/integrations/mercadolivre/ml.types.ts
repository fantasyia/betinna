/**
 * Tipos da API do Mercado Livre.
 * Docs: https://developers.mercadolivre.com.br/
 */

// ─── OAuth / Credenciais ─────────────────────────────────────────────

export interface MLCredenciais {
  userId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms — quando o accessToken expira. */
  expiresAt: number;
  nickname?: string;
  siteId?: string; // MLB (BR), MLA (AR), MLM (MX), etc.
}

export interface MLTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token: string;
}

export interface MLUserInfo {
  id: number;
  nickname?: string;
  email?: string;
  site_id?: string;
  first_name?: string;
  last_name?: string;
}

// ─── Webhook ─────────────────────────────────────────────────────────

export type MLTopic =
  | 'questions'
  | 'messages'
  | 'orders_v2'
  | 'items'
  | 'claims'
  | 'post_purchase_claims'
  | 'marketplace_questions'
  | 'marketplace_messages'
  | 'marketplace_orders';

export interface MLWebhookNotification {
  _id?: string;
  resource: string;
  user_id: number;
  topic: MLTopic | string;
  application_id?: number;
  attempts?: number;
  sent?: string;
  received?: string;
}

// ─── Questions (perguntas pré-venda) ─────────────────────────────────

export type MLQuestionStatus =
  | 'UNANSWERED'
  | 'ANSWERED'
  | 'CLOSED_UNANSWERED'
  | 'UNDER_REVIEW'
  | 'DELETED'
  | 'BANNED';

export interface MLQuestion {
  id: number;
  text: string;
  status: MLQuestionStatus;
  date_created: string;
  item_id: string;
  seller_id: number;
  from: { id: number; answered_questions?: number };
  answer?: { text: string; status: string; date_created: string };
}

export interface MLAnswer {
  question_id: number;
  text: string;
}

// ─── Messages (chat pós-venda em pack/pedido) ────────────────────────

export interface MLMessage {
  id: string;
  from: { user_id: number };
  to: { user_id: number };
  text: { plain: string };
  status: string;
  message_date: {
    received?: string;
    available?: string;
    notified?: string;
    created?: string;
    read?: string;
  };
  message_attachments?: Array<{ filename?: string; original_filename?: string }>;
}

export interface MLMessagesResponse {
  paging: { limit: number; offset: number; total: number };
  messages: MLMessage[];
  conversation_status?: { status: string; substatus?: string };
}

// ─── Orders ──────────────────────────────────────────────────────────

export interface MLOrderItem {
  item: { id: string; title: string; variation_id?: number | null };
  quantity: number;
  unit_price: number;
  full_unit_price?: number;
  currency_id: string;
}

export interface MLOrderBuyer {
  id: number;
  nickname?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: { area_code?: string; number?: string };
}

export interface MLOrder {
  id: number;
  status: string; // confirmed, payment_required, payment_in_process, paid, cancelled, etc.
  status_detail?: { description?: string; code?: string };
  date_created: string;
  date_closed?: string;
  total_amount: number;
  currency_id: string;
  buyer: MLOrderBuyer;
  order_items: MLOrderItem[];
  pack_id?: number | null;
  /** True quando faz parte de um pack (vários pedidos em um chat). */
  shipping?: { id: number; status?: string };
  feedback?: { sale?: { id: number }; purchase?: { id: number } };
}

// ─── Claims (reclamações pós-compra) ─────────────────────────────────

export type MLClaimType =
  | 'mediations'
  | 'cancel_purchase'
  | 'return'
  | 'change'
  | 'product'
  | 'service';

export type MLClaimStatus =
  | 'opened'
  | 'closed'
  | 'expired'
  | 'cancelled'
  | 'closed_with_refund'
  | 'closed_with_response'
  | string;

export type MLClaimStage = 'claim' | 'dispute' | 'recontact' | 'none' | string;

export interface MLClaim {
  id: number;
  type: MLClaimType | string;
  stage: MLClaimStage;
  status: MLClaimStatus;
  reason_id?: string;
  status_detail?: string;
  resource: 'order' | 'shipment' | 'message' | string;
  resource_id: number;
  related_entities?: Array<{ resource: string; resource_id: number }>;
  date_created: string;
  last_updated: string;
  resolution?: {
    closed_by?: string;
    reason?: string;
    date_created?: string;
    benefited?: string[];
  } | null;
  players?: Array<{ role: string; user_id: number; type: string; available_actions?: unknown[] }>;
  /** Quando há SLA — campo expiration_date no payload. */
  expiration_date?: string | null;
}

export interface MLClaimsSearchResponse {
  paging: { total: number; offset: number; limit: number };
  data: MLClaim[];
}

export interface MLClaimMessage {
  date_created: string;
  message: string;
  sender_role?: string;
  receiver_role?: string;
  /** Atos anexos a uma claim — texts/files. */
  type?: string;
  attachments?: Array<{ filename?: string; url?: string }>;
}
