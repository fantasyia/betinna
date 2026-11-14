/**
 * Tipos da Open API do Magalu (developers.magalu.com, 14/11).
 * Só os campos que o Betinna lê — a API devolve bem mais.
 */

/** Credenciais persistidas em IntegracaoConexao(servico='magalu'). */
export interface MagaluCredenciais {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
  /** Escopos concedidos (o que o seller aceitou no consentimento). */
  scope?: string;
  /** GET /seller/v1/portfolios/me — melhor esforço. */
  tenantId?: string;
  sellerId?: string;
  sellerNome?: string;
  channelId?: string;
}

/** Resposta de https://id.magalu.com/oauth/token (code e refresh). */
export interface MagaluTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  /** segundos (ex.: 7200) */
  expires_in: number;
  scope?: string;
  created_at?: number;
}

/** Valor em centavos com normalizador (total / normalizer = reais). */
export interface MagaluValor {
  total?: number | null;
  normalizer?: number | null;
  currency?: string | null;
}

export interface MagaluItemEntrega {
  quantity?: number | null;
  unit_price?: { value?: number | null; normalizer?: number | null } | null;
  amounts?: (MagaluValor & { commission?: MagaluValor | null }) | null;
  info?: {
    sku?: string | null;
    name?: string | null;
    attributes?: Array<{ name?: string; value?: string }> | null;
  } | null;
}

export interface MagaluEntrega {
  id?: string;
  code?: string;
  /** new | approved | invoiced | shipped | delivered | cancelled | frozen */
  status?: string | null;
  items?: MagaluItemEntrega[] | null;
  amounts?:
    | (MagaluValor & { commission?: MagaluValor | null; freight?: MagaluValor | null })
    | null;
  shipping?: { tracking_url?: string | null } | null;
  returns?: Array<{ status?: string | null }> | null;
}

/** GET /seller/v1/orders → results[] */
export interface MagaluPedido {
  id: string;
  code: string;
  /** new | approved | cancelled | finished */
  status?: string | null;
  purchased_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  amounts?:
    | (MagaluValor & { commission?: MagaluValor | null; freight?: MagaluValor | null })
    | null;
  customer?: { name?: string | null } | null;
  deliveries?: MagaluEntrega[] | null;
}

/** Envelope de listagem (`meta` + `results`). */
export interface MagaluLista<T> {
  meta?: { page?: { limit?: number; offset?: number; count?: number; total?: number } };
  results?: T[];
}

/** GET /seller/v0/tickets → results[] (SAC). */
export interface MagaluTicket {
  id: string;
  code?: string | null;
  protocol?: string | null;
  /** shipping | cancellation | payment | general | exchange | product_question | feedback | ... */
  type?: string | null;
  reason?: string | null;
  /** waiting_seller | waiting_customer | closed | refund_authorized | ... */
  status?: string | null;
  closed?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  due_date?: string | null;
  order?: {
    id?: string;
    code?: string;
    delivery?: { items?: Array<{ sku?: string; name?: string; quantity?: number }> };
  } | null;
}
