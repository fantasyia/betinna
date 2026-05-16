/**
 * Tipos da TikTok Shop Partner API.
 *
 * Docs: https://partner.tiktokshop.com/docv2
 *
 * Particularidades:
 *  - HMAC SHA-256 em cada request (fórmula sandwich com app_secret)
 *  - Shop authorization via redirect (services.tiktokshop.com)
 *  - access_token (TTL ~7 dias) + refresh_token (TTL ~365 dias)
 *  - Webhook com header `x-tts-signature` (HMAC SHA-256 do body cru)
 *  - Versão da API no path (`/return_refund/202309/...`)
 *
 * Limitações conhecidas:
 *  - Não há API pública pra chat livre comprador↔vendedor (TikTok mantém
 *    isso só no Seller Center). Conseguimos cobrir Returns/Refunds, Orders,
 *    Reviews leitura.
 */

// ─── OAuth ─────────────────────────────────────────────────────────────

export interface TikTokCredenciais {
  shopId: string;
  shopCipher?: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms — quando o accessToken expira. */
  expiresAt: number;
  /** Epoch ms — quando o refresh_token expira (~365 dias). */
  refreshExpiresAt?: number;
  sellerName?: string;
  region?: string; // BR, US, ID, MY, etc.
}

export interface TikTokTokenResponse {
  data: {
    access_token: string;
    access_token_expire_in: number; // epoch seconds
    refresh_token: string;
    refresh_token_expire_in: number;
    open_id?: string;
    seller_name?: string;
    seller_base_region?: string;
    user_type?: number;
    granted_scopes?: string[];
    shop_list?: Array<{ id: string; cipher?: string; region?: string; name?: string }>;
  };
  message: string;
  code: number;
  request_id?: string;
}

// ─── Webhook ───────────────────────────────────────────────────────────

export type TikTokWebhookType =
  | 'ORDER_STATUS_CHANGE'
  | 'RETURN_STATUS_CHANGE'
  | 'REVERSE_ORDER_STATUS_CHANGE'
  | 'SHIPMENT_INFO_CHANGE'
  | 'PRODUCT_STATUS_CHANGE'
  | string;

export interface TikTokWebhookEnvelope {
  type: TikTokWebhookType | number;
  shop_id?: string;
  timestamp?: number;
  data: Record<string, unknown>;
  /** Algumas APIs envelopam diferente — mantemos flexível. */
  tts_notification_id?: string;
}

// ─── Orders ────────────────────────────────────────────────────────────

export interface TikTokOrderLineItem {
  id: string;
  product_id?: string;
  product_name?: string;
  sku_id?: string;
  sku_name?: string;
  seller_sku?: string;
  original_price?: string;
  sale_price?: string;
  currency?: string;
}

export interface TikTokOrder {
  id: string;
  status: string; // UNPAID, AWAITING_SHIPMENT, AWAITING_COLLECTION, IN_TRANSIT, DELIVERED, COMPLETED, CANCELLED
  buyer_email?: string;
  buyer_message?: string;
  buyer_uid?: string;
  cancel_reason?: string;
  create_time: number;
  update_time: number;
  paid_time?: number;
  shipping_due_time?: number;
  line_items: TikTokOrderLineItem[];
  payment?: {
    currency: string;
    total_amount: string;
  };
  recipient_address?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    full_address?: string;
  };
}

export interface TikTokOrderListResponse {
  data: {
    orders: Array<{ id: string }>;
    total_count?: number;
    next_page_token?: string;
    more?: boolean;
  };
  code: number;
  message: string;
}

// ─── Returns ───────────────────────────────────────────────────────────

export type TikTokReturnStatus =
  | 'RETURN_OR_REFUND_REQUEST_PENDING'
  | 'AWAITING_BUYER_SHIP'
  | 'AWAITING_SELLER_CONFIRM_RECEIVE'
  | 'BUYER_CANCEL_REQUEST'
  | 'REFUND_SUCCESS'
  | 'REFUND_FAIL'
  | 'CLOSED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'IN_ARBITRATION'
  | string;

export interface TikTokReturn {
  return_id: string;
  order_id: string;
  status: TikTokReturnStatus;
  return_type?: 'REFUND_ONLY' | 'RETURN_AND_REFUND' | string;
  refund_amount?: { amount: string; currency: string };
  return_reason?: string;
  return_reason_text?: string;
  buyer_id?: string;
  create_time: number;
  update_time: number;
  /** SLA seller pra responder. */
  seller_proposal_deadline?: number;
  arbitration_deadline?: number;
  /** Lista de items afetados. */
  return_line_items?: Array<{
    product_id?: string;
    product_name?: string;
    sku_id?: string;
    quantity?: number;
    refund_amount?: { amount: string; currency: string };
  }>;
}

export interface TikTokReturnListResponse {
  data: {
    return_records: TikTokReturn[];
    total_count?: number;
    next_page_token?: string;
  };
  code: number;
  message: string;
}
