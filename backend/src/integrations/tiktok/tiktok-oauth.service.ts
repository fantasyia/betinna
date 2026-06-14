import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import {
  deriveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
} from '@shared/utils/oauth-state.util';
import type { TikTokCredenciais, TikTokTokenResponse } from './tiktok.types';

const AUTH_URL = 'https://services.tiktokshop.com/open/authorize';
const TOKEN_URL = 'https://auth.tiktok-shops.com/api/v2/token/get';
const REFRESH_URL = 'https://auth.tiktok-shops.com/api/v2/token/refresh';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * Shop authorization da TikTok Shop + gerenciamento automático de tokens.
 *
 * Fluxo:
 *  1. `buildAuthUrl(empresaId)` redireciona pra services.tiktokshop.com/open/authorize
 *  2. TikTok redireciona de volta com `code` + `state`
 *  3. `processCallback(code, state)` troca code por access_token (~7 dias) +
 *     refresh_token (~365 dias), persiste em IntegracaoConexao
 *  4. `getCredenciais(empresaId)` retorna token válido (refresh transparente
 *     com 60s margem)
 *
 * `externalAccountId` = shop_id (primeiro shop da lista quando há múltiplos).
 *
 * Diferenças vs Shopee: TikTok usa `service_id` em vez de `partner_id` na
 * authorize URL e endpoint /token/get é REST GET com query params (não POST).
 */
@Injectable()
export class TikTokOAuthService {
  private readonly logger = new Logger(TikTokOAuthService.name);
  private readonly stateSecret: Uint8Array;

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
  ) {
    this.stateSecret = deriveOAuthStateSecret(this.env.get('ENCRYPTION_KEY'), 'tiktok-oauth-state');
  }

  isConfigured(): boolean {
    return !!(
      this.env.get('TIKTOK_APP_KEY') &&
      this.env.get('TIKTOK_APP_SECRET') &&
      this.env.get('TIKTOK_SERVICE_ID') &&
      this.env.get('TIKTOK_REDIRECT_URI')
    );
  }

  async buildAuthUrl(empresaId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new IntegrationException(
        'TikTok Shop não configurada — defina TIKTOK_APP_KEY/APP_SECRET/SERVICE_ID/REDIRECT_URI',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const state = await this.signState(empresaId);
    const params = new URLSearchParams({
      service_id: this.env.get('TIKTOK_SERVICE_ID'),
      state,
    });
    return `${AUTH_URL}?${params}`;
  }

  async processCallback(
    code: string,
    state: string,
  ): Promise<{ empresaId: string; shopId: string }> {
    const empresaId = await this.verifyState(state);
    const tokenRes = await this.exchangeCode(code);
    if (tokenRes.code !== 0 || !tokenRes.data?.access_token) {
      throw new IntegrationException(
        `TikTok /token/get falhou: ${tokenRes.message ?? '?'}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const data = tokenRes.data;
    const shop = data.shop_list?.[0];
    if (!shop) {
      throw new IntegrationException(
        'TikTok /token/get sem shop vinculado — verifique se o app tem permissão de shop',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const creds: TikTokCredenciais = {
      shopId: shop.id,
      shopCipher: shop.cipher,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.access_token_expire_in * 1000,
      refreshExpiresAt: data.refresh_token_expire_in * 1000,
      sellerName: data.seller_name,
      region: shop.region ?? data.seller_base_region,
    };
    await this.persistir(empresaId, creds);
    this.logger.log(
      `TikTok Shop conectada empresa=${empresaId} shop_id=${shop.id} region=${creds.region ?? '?'}`,
    );
    return { empresaId, shopId: shop.id };
  }

  async getCredenciais(empresaId: string): Promise<TikTokCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'tiktok');
    const c = conn.credenciais as Partial<TikTokCredenciais>;
    if (!c.accessToken || !c.refreshToken || !c.expiresAt || !c.shopId) {
      throw new IntegrationException(
        'Credenciais TikTok Shop incompletas — reconecte o OAuth',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (c.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return c as TikTokCredenciais;
    }
    this.logger.debug(`Refresh access_token TikTok — empresa=${empresaId}`);
    const tokenRes = await this.refresh(c.refreshToken);
    if (tokenRes.code !== 0 || !tokenRes.data?.access_token) {
      throw new IntegrationException(
        `TikTok refresh falhou: ${tokenRes.message ?? '?'}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const data = tokenRes.data;
    const novo: TikTokCredenciais = {
      shopId: c.shopId,
      shopCipher: c.shopCipher,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? c.refreshToken,
      expiresAt: data.access_token_expire_in * 1000,
      refreshExpiresAt: data.refresh_token_expire_in
        ? data.refresh_token_expire_in * 1000
        : c.refreshExpiresAt,
      sellerName: c.sellerName,
      region: c.region,
    };
    await this.persistir(empresaId, novo);
    return novo;
  }

  /** Lookup reverso: shop_id → empresaId (pro webhook). */
  async resolverPorShopId(shopId: string): Promise<string | null> {
    const conn = await this.prisma.integracaoConexao.findFirst({
      where: { servico: 'tiktok', externalAccountId: shopId, ativo: true },
      select: { empresaId: true },
    });
    return conn?.empresaId ?? null;
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private async exchangeCode(code: string): Promise<TikTokTokenResponse> {
    const params = new URLSearchParams({
      app_key: this.env.get('TIKTOK_APP_KEY'),
      app_secret: this.env.get('TIKTOK_APP_SECRET'),
      auth_code: code,
      grant_type: 'authorized_code',
    });
    return this.getToken(`${TOKEN_URL}?${params}`);
  }

  private async refresh(refreshToken: string): Promise<TikTokTokenResponse> {
    const params = new URLSearchParams({
      app_key: this.env.get('TIKTOK_APP_KEY'),
      app_secret: this.env.get('TIKTOK_APP_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    return this.getToken(`${REFRESH_URL}?${params}`);
  }

  private async getToken(url: string): Promise<TikTokTokenResponse> {
    try {
      const res = await this.http.get<TikTokTokenResponse>(url, {
        integration: 'tiktok',
        redactKeys: ['app_secret', 'auth_code', 'refresh_token', 'access_token'],
        retries: 1,
      });
      return res.data;
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 300)
            : String(err.body ?? '').slice(0, 300);
        throw new IntegrationException(
          `TikTok /auth HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }

  private async persistir(empresaId: string, creds: TikTokCredenciais): Promise<void> {
    await this.integracoes.salvarCredenciaisInternas(
      empresaId,
      'tiktok',
      creds as unknown as Record<string, unknown>,
      creds.shopId,
    );
  }

  private signState(empresaId: string): Promise<string> {
    return signOAuthState(this.stateSecret, { eid: empresaId });
  }

  private verifyState(state: string): Promise<string> {
    return verifyOAuthState(this.stateSecret, state, 'eid');
  }
}
