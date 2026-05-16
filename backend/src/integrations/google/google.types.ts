/**
 * Tipos do Google OAuth 2.0 e Calendar API v3.
 * Documentação:
 *  - OAuth: https://developers.google.com/identity/protocols/oauth2/web-server
 *  - Calendar: https://developers.google.com/calendar/api/v3/reference
 */

export interface GoogleCalendarCredenciais {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms — quando o accessToken expira. */
  expiresAt: number;
  /** Conta vinculada (e-mail), informativo. */
  email?: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

// ─── Calendar Events ─────────────────────────────────────────────────────

export interface GoogleEventDateTime {
  dateTime?: string; // RFC3339 com timezone (ex: "2026-05-14T15:00:00-03:00")
  date?: string; // YYYY-MM-DD para all-day
  timeZone?: string;
}

export interface GoogleEvent {
  id?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  attendees?: Array<{ email: string; displayName?: string }>;
  htmlLink?: string;
  hangoutLink?: string;
  reminders?: { useDefault: boolean };
}

export interface GoogleEventsListResponse {
  items: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleEventCreateParams {
  titulo: string;
  inicio: Date;
  fim: Date;
  descricao?: string;
  local?: string;
  /** Lista de participantes (e-mail). Convites enviados pelo Google. */
  participantes?: Array<{ email: string; nome?: string }>;
  /** Default 'America/Sao_Paulo'. */
  timezone?: string;
}
