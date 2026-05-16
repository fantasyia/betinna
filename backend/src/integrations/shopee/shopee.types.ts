/**
 * Tipos da Shopee Open Platform v2.
 * Docs: https://open.shopee.com/documents
 *
 * Particularidades:
 *  - HMAC SHA-256 em CADA request (não só webhook)
 *  - Sig vai em query param `?sign=<hex>`
 *  - Shop authorization via redirect partner-level (não OAuth padrão)
 *  - Token rotation: access_token 4h, refresh_token 30 dias
 */

// ─── OAuth / Credenciais ─────────────────────────────────────────────

export interface ShopeeCredenciais {
  shopId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms — quando o accessToken expira. */
  expiresAt: number;
  /** "main account" do seller, informativo. */
  mainAccountId?: string;
  /** Região da loja: BR, SG, ID, MY, PH, TW, TH, VN. */
  region?: string;
}

export interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  request_id?: string;
  merchant_id_list?: number[];
  shop_id_list?: number[];
  error?: string;
  message?: string;
}

// ─── Webhook push notification ────────────────────────────────────────

/**
 * Códigos de push relevantes pra SAC (incompleto — extender conforme uso):
 *  - 3  : order status update
 *  - 4  : tracking number push
 *  - 6  : return / refund status update
 *  - 7  : chat message
 *  - 15 : return seller proof upload
 *  - 16 : dispute escalation
 */
export type ShopeePushCode = 3 | 4 | 6 | 7 | 15 | 16 | number;

export interface ShopeeWebhookEnvelope {
  shop_id?: number;
  merchant_id?: number;
  code: ShopeePushCode;
  timestamp: number;
  data: Record<string, unknown>;
}

// ─── Chat ─────────────────────────────────────────────────────────────

export interface ShopeeChatMessage {
  message_id: string;
  message_type: 'text' | 'image' | 'sticker' | 'item' | 'order' | string;
  from_id: number;
  from_shop_id?: number;
  to_id: number;
  to_shop_id?: number;
  conversation_id: string;
  created_timestamp: number;
  source?: string;
  source_content?: Record<string, unknown>;
  content?: {
    text?: string;
    url?: string;
    sticker_id?: string;
    file_name?: string;
    item_id?: number;
    order_sn?: string;
  };
}

export interface ShopeeChatGetMessageResponse {
  response: {
    messages: ShopeeChatMessage[];
    page_result?: { next_offset?: string; more?: boolean };
  };
}

// ─── Returns / Refunds ────────────────────────────────────────────────

export type ShopeeReturnStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'CANCELLED'
  | 'JUDGING'
  | 'REFUND_PAID'
  | 'CLOSED'
  | 'PROCESSING'
  | 'SELLER_DISPUTE'
  | string;

export interface ShopeeReturn {
  return_sn: string;
  order_sn: string;
  user: { username?: string; email?: string; portrait?: string };
  status: ShopeeReturnStatus;
  reason?: string;
  text_reason?: string;
  refund_amount?: number;
  currency?: string;
  create_time: number;
  update_time: number;
  due_date?: number;
  /** Quando o seller pode disputar. */
  needs_logistics?: boolean;
  /** Lista de items afetados. */
  item?: Array<{
    item_id?: number;
    name?: string;
    images?: string[];
    amount_before_discount?: number;
    refund_amount?: number;
  }>;
  /** Histórico de tratativas (textos do comprador, vendedor, plataforma). */
  negotiation?: {
    negotiation_status?: string;
    latest_solution?: string;
    latest_offer_creator?: string;
  };
}

export interface ShopeeReturnListResponse {
  response: {
    return: ShopeeReturn[];
    more: boolean;
  };
}

// ─── Orders ───────────────────────────────────────────────────────────

export interface ShopeeOrderItem {
  item_id: number;
  item_name: string;
  item_sku?: string;
  model_id?: number;
  model_name?: string;
  model_quantity_purchased: number;
  model_original_price: number;
  model_discounted_price: number;
}

export interface ShopeeOrder {
  order_sn: string;
  order_status: string; // UNPAID, READY_TO_SHIP, SHIPPED, COMPLETED, CANCELLED, etc.
  buyer_username?: string;
  total_amount?: number;
  currency?: string;
  create_time: number;
  update_time: number;
  pay_time?: number;
  ship_by_date?: number;
  item_list: ShopeeOrderItem[];
}

export interface ShopeeOrderListResponse {
  response: {
    order_list: Array<{ order_sn: string }>;
    more: boolean;
    next_cursor?: string;
  };
}
