import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { UsuarioIntegracoesService } from '@modules/integracoes/usuario-integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import {
  deriveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
} from '@shared/utils/oauth-state.util';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import type {
  GoogleCalendarCredenciais,
  GoogleTokenResponse,
  GoogleUserInfo,
} from './google.types';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events openid email profile';
const TOKEN_REFRESH_MARGIN_MS = 60_000; // refresh 60s antes de expirar

/**
 * OAuth 2.0 com Google + gerenciamento de access/refresh tokens.
 *
 * Fluxo:
 *  1. Frontend → `buildAuthUrl(userId)` retorna a URL pra mandar o user pro Google
 *  2. Google redireciona pro callback com `code` e `state`
 *  3. `exchangeCode(code, state)` valida o state (assinado HS256), troca o code
 *     por tokens e persiste em `UsuarioIntegracao` (cifrado)
 *  4. Outros services chamam `getAccessToken(userId)` que faz refresh automático
 *     quando necessário e devolve o token válido
 *
 * O `state` é um JWT HS256 derivado da ENCRYPTION_KEY com:
 *  - sub = userId
 *  - exp = agora + 5min
 *  - nonce = random
 * Impede CSRF e replay attacks.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly stateSecret: Uint8Array;

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly userIntegracoes: UsuarioIntegracoesService,
  ) {
    // Deriva uma chave separada pro state JWT a partir da ENCRYPTION_KEY
    // (mesmo segredo mas hash diferente — isolamento criptográfico).
    this.stateSecret = deriveOAuthStateSecret(this.env.get('ENCRYPTION_KEY'), 'google-oauth-state');
  }

  isConfigured(): boolean {
    return !!(
      this.env.get('GOOGLE_CLIENT_ID') &&
      this.env.get('GOOGLE_CLIENT_SECRET') &&
      this.env.get('GOOGLE_REDIRECT_URI')
    );
  }

  async buildAuthUrl(userId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new IntegrationException(
        'Google OAuth não configurado — defina GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const state = await this.signState(userId);
    const params = new URLSearchParams({
      client_id: this.env.get('GOOGLE_CLIENT_ID'),
      redirect_uri: this.env.get('GOOGLE_REDIRECT_URI'),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /**
   * Trata o callback do Google: valida state, troca o code, persiste tokens.
   * Retorna { userId, email } da conta vinculada.
   */
  async exchangeCode(code: string, state: string): Promise<{ userId: string; email: string }> {
    const userId = await this.verifyState(state);

    const tokenRes = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.env.get('GOOGLE_REDIRECT_URI'),
    });
    if (!tokenRes.refresh_token) {
      throw new IntegrationException(
        'Google não devolveu refresh_token — confirme prompt=consent + access_type=offline',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    // Pega o e-mail da conta vinculada (UX)
    const userInfo = await this.fetchUserInfo(tokenRes.access_token);

    const credenciais: GoogleCalendarCredenciais = {
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token,
      expiresAt: Date.now() + tokenRes.expires_in * 1000,
      email: userInfo.email,
    };
    await this.userIntegracoes.conectarInterno(
      userId,
      'google_calendar',
      credenciais as unknown as Record<string, unknown>,
    );
    this.logger.log(`Google Calendar conectado — usuário=${userId}`);
    return { userId, email: userInfo.email };
  }

  /**
   * Obtém access_token válido. Refresh automático quando próximo de expirar.
   * Usado pelos services que chamam APIs do Google.
   */
  async getAccessToken(userId: string): Promise<string> {
    const conn = await this.userIntegracoes.obterCredenciaisInternas(userId, 'google_calendar');
    const c = conn.credenciais as Partial<GoogleCalendarCredenciais>;
    if (!c.accessToken || !c.refreshToken || !c.expiresAt) {
      throw new IntegrationException(
        'Credenciais Google Calendar incompletas — reconecte o OAuth',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (c.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return c.accessToken;
    }
    // Refresh
    this.logger.debug(`Refresh access_token Google — usuário=${userId}`);
    const tokenRes = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: c.refreshToken,
    });
    const novo: GoogleCalendarCredenciais = {
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token ?? c.refreshToken,
      expiresAt: Date.now() + tokenRes.expires_in * 1000,
      email: c.email,
    };
    await this.userIntegracoes.conectarInterno(
      userId,
      'google_calendar',
      novo as unknown as Record<string, unknown>,
    );
    return novo.accessToken;
  }

  // ─── Internos ──────────────────────────────────────────────────────────

  private async requestToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
    const form = new URLSearchParams({
      client_id: this.env.get('GOOGLE_CLIENT_ID'),
      client_secret: this.env.get('GOOGLE_CLIENT_SECRET'),
      ...params,
    });
    try {
      const res = await this.http.post<GoogleTokenResponse>(TOKEN_URL, {
        body: form,
        integration: 'google',
        redactKeys: ['client_secret', 'code', 'refresh_token', 'access_token'],
        retries: 2,
      });
      if (!res.data?.access_token) {
        throw new IntegrationException(
          'Google /token retornou sem access_token',
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      return res.data;
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 300)
            : String(err.body ?? '').slice(0, 300);
        throw new IntegrationException(
          `Google /token HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }

  private async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const res = await this.http.get<GoogleUserInfo>(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      integration: 'google',
      retries: 1,
    });
    return res.data;
  }

  private signState(userId: string): Promise<string> {
    return signOAuthState(this.stateSecret, { uid: userId });
  }

  private verifyState(state: string): Promise<string> {
    return verifyOAuthState(this.stateSecret, state, 'uid');
  }
}
