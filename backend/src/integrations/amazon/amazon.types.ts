/**
 * Tipos da Amazon Selling Partner API (SP-API).
 *
 * Docs: https://developer-docs.amazon.com/sp-api/
 *
 * Particularidades:
 *  - LWA OAuth (Login with Amazon) pra obter refresh_token (longa-duração) +
 *    access_token (1h)
 *  - Amazon REMOVEU o requisito de AWS Signature v4 em 10/2023 — agora basta
 *    `x-amz-access-token` no header dos requests SP-API
 *  - Endpoints por região: NA, EU, FE
 *  - Sem chat livre: Messaging API tem `Permitted Actions` estruturadas
 *  - Notifications via SQS (não webhook HTTP) — MVP usa pull periódico
 *  - Restricted Data Tokens (RDT) pra endpoints com PII — MVP evita
 */

// ─── OAuth / Credenciais ─────────────────────────────────────────────

export interface AmazonCredenciais {
  sellingPartnerId: string;
  refreshToken: string;
  accessToken: string;
  /** Epoch ms — quando o accessToken expira (typically agora+3600s). */
  expiresAt: number;
  /** Marketplace primário do seller (ex: A2Q3Y263D00KWC pra Brasil). */
  marketplaceId?: string;
}

export interface AmazonLwaTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

// ─── Region routing ───────────────────────────────────────────────────

export type AmazonRegion = 'NA' | 'EU' | 'FE';

/** Host da SP-API por região (sem path). */
export const AMAZON_SPAPI_HOSTS: Record<AmazonRegion, string> = {
  NA: 'sellingpartnerapi-na.amazon.com',
  EU: 'sellingpartnerapi-eu.amazon.com',
  FE: 'sellingpartnerapi-fe.amazon.com',
};

/** Sandbox hosts (mesma estrutura). */
export const AMAZON_SPAPI_SANDBOX_HOSTS: Record<AmazonRegion, string> = {
  NA: 'sandbox.sellingpartnerapi-na.amazon.com',
  EU: 'sandbox.sellingpartnerapi-eu.amazon.com',
  FE: 'sandbox.sellingpartnerapi-fe.amazon.com',
};

// ─── Orders API ───────────────────────────────────────────────────────

export interface AmazonOrderItem {
  ASIN: string;
  SellerSKU?: string;
  OrderItemId: string;
  Title?: string;
  QuantityOrdered: number;
  QuantityShipped?: number;
  ItemPrice?: { CurrencyCode: string; Amount: string };
  ShippingPrice?: { CurrencyCode: string; Amount: string };
}

export interface AmazonOrder {
  AmazonOrderId: string;
  PurchaseDate: string;
  LastUpdateDate: string;
  OrderStatus: string; // Pending, Unshipped, PartiallyShipped, Shipped, Canceled, Unfulfillable, InvoiceUnconfirmed
  FulfillmentChannel?: 'MFN' | 'AFN'; // Merchant / Amazon
  SalesChannel?: string;
  OrderTotal?: { CurrencyCode: string; Amount: string };
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  MarketplaceId: string;
  BuyerInfo?: {
    BuyerEmail?: string;
    BuyerName?: string;
    PurchaseOrderNumber?: string;
  };
  ShippingAddress?: {
    Name?: string;
    City?: string;
    StateOrRegion?: string;
    CountryCode?: string;
    PostalCode?: string;
  };
  IsPremiumOrder?: boolean;
  IsBusinessOrder?: boolean;
  EarliestShipDate?: string;
  LatestShipDate?: string;
}

export interface AmazonOrdersListResponse {
  payload: {
    Orders: AmazonOrder[];
    NextToken?: string;
    LastUpdatedBefore?: string;
    CreatedBefore?: string;
  };
}

export interface AmazonOrderItemsResponse {
  payload: {
    AmazonOrderId: string;
    OrderItems: AmazonOrderItem[];
    NextToken?: string;
  };
}

// ─── Messaging API ────────────────────────────────────────────────────

/**
 * Ações permitidas pra um pedido no Messaging API.
 * https://developer-docs.amazon.com/sp-api/docs/messaging-api-v1-reference
 *
 * Foco do projeto = SAC (atendimento ao cliente). Ações de NFe/invoice são
 * tratadas FORA deste sistema (pelo hub fiscal do cliente), então não
 * implementamos sendInvoice nem Uploads API aqui.
 *
 * Implementadas (texto livre / interação com comprador):
 *  - confirmDeliveryDetails  : pedir confirmação de entrega
 *  - confirmOrderDetails     : confirmar detalhes do pedido
 *  - unexpectedProblem       : reportar problema inesperado
 *  - getCustomerInformation  : solicitar info ao comprador
 */
export type AmazonPermittedAction =
  | 'confirmCustomizationDetails'
  | 'confirmDeliveryDetails'
  | 'confirmOrderDetails'
  | 'confirmServiceDetails'
  | 'createAmazonMotors'
  | 'createConfirmCustomizationDetails'
  | 'createDigitalAccessKey'
  | 'createWarranty'
  | 'getCustomerInformation'
  | 'getCustomizationInformation'
  | 'unexpectedProblem';

export interface AmazonMessagingActionsResponse {
  _links?: {
    self?: { href: string };
    actions?: Array<{ href: string; name: AmazonPermittedAction }>;
  };
  payload?: unknown;
}

/** Body genérico que aceita `text`. Várias ações compartilham essa estrutura. */
export interface AmazonMessagingTextBody {
  text?: string;
}

// ─── Notifications (futuro — usa SQS, MVP usa pull) ──────────────────

export type AmazonNotificationType =
  | 'ORDER_CHANGE'
  | 'MFN_ORDER_STATUS_CHANGE'
  | 'B2B_ANY_OFFER_CHANGED'
  | 'BRANDED_ITEM_CONTENT_CHANGE'
  | 'ITEM_PRODUCT_TYPE_CHANGE'
  | 'LISTINGS_ITEM_STATUS_CHANGE'
  | 'PRICING_HEALTH'
  | 'ACCOUNT_STATUS_CHANGED'
  | string;
