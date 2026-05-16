/**
 * Tipos da Meta Graph API (Facebook + Instagram Messaging).
 * Docs:
 *  - Facebook Login: https://developers.facebook.com/docs/facebook-login
 *  - Messenger Platform: https://developers.facebook.com/docs/messenger-platform
 *  - Instagram Messaging: https://developers.facebook.com/docs/messenger-platform/instagram
 */

// ─── OAuth ────────────────────────────────────────────────────────────

export interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface MetaPage {
  id: string;
  name: string;
  /** Page Access Token (long-lived quando origem é user-token long-lived). */
  access_token: string;
  category?: string;
  tasks?: string[];
}

export interface MetaInstagramBusinessAccount {
  id: string;
  username?: string;
  name?: string;
}

// ─── Credenciais persistidas por empresa ─────────────────────────────

export interface FacebookCredenciais {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  /** User token (long-lived, ~60 dias). Mantemos pra renovar page token se necessário. */
  userAccessToken?: string;
  userTokenExpiresAt?: number;
}

export interface InstagramCredenciais {
  /** Page vinculada ao IG. Mensagens IG usam o Page Access Token. */
  pageId: string;
  pageAccessToken: string;
  /** IG Business Account ID (IGSID da conta) — endpoint base pra envios. */
  igUserId: string;
  igUsername?: string;
  userAccessToken?: string;
  userTokenExpiresAt?: number;
}

// ─── Webhook payloads ────────────────────────────────────────────────

/**
 * Envelope comum de webhooks do Meta.
 * `object` indica o produto: 'page' (Messenger), 'instagram' (IG Direct).
 */
export interface MetaWebhookEnvelope {
  object: 'page' | 'instagram' | string;
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string;
  time: number;
  messaging?: MetaMessagingEvent[];
  /** Eventos IG via 'changes' (mensagens vêm em 'messaging' tb, dependendo da config). */
  changes?: Array<{ field: string; value: unknown }>;
}

export interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: MetaIncomingMessage;
  /** Eventos de status/leitura (delivery/read) — ignoramos no MVP. */
  delivery?: unknown;
  read?: unknown;
  /** Echo de mensagens nossas (quando is_echo=true). */
  is_echo?: boolean;
}

export interface MetaIncomingMessage {
  mid: string;
  text?: string;
  is_echo?: boolean;
  attachments?: Array<{
    type: 'image' | 'video' | 'audio' | 'file' | 'location' | string;
    payload?: { url?: string; coordinates?: { lat: number; long: number } };
  }>;
  reply_to?: { mid: string };
}

// ─── Envio ───────────────────────────────────────────────────────────

export interface MetaSendTextResult {
  recipient_id: string;
  message_id: string;
}
