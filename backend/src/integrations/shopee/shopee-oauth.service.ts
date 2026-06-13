import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { CryptoUtil } from '@shared/utils/crypto.util';
import {
  deriveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
} from '@shared/utils/oauth-state.util';
import { ShopeeSigner } from './shopee-signer';
import type { ShopeeCredenciais, ShopeeTokenResponse } from './shopee.types';

const TOKEN_REFRESH_MARGIN_MS = 60_000;

const PATH_AUTH_PARTNER = '/api/v2/shop/auth_partner';
const PATH_TOKEN_GET = '/api/v2/auth/token/get';
const PATH_REFRESH = '/api/v2/auth/access_token/get';

/**
 * Shop authorization da Shopee + gerenciamento de tokens.
 *
 * Fluxo:
 *  1. `buildAuthUrl(empresaId)` redireciona pra `/shop/auth_partner` assinado
 *  2. Shopee redireciona de volta com `?code=&shop_id=&main_account_id=`
 *  3. `processCallback(code, shopId, state)` troca code por access+refresh
 *     tokens e persiste em IntegracaoConexao(servico='shopee')
 *  4. `getAccessToken(empresaId)` retorna token válido (refresh transparente)
 *
 * `externalAccountId` = `shop_id` (não-cifrado, indexável) pra routing reverso
 * de webhooks.
 */
@Injectable()
export class ShopeeOAuthService {
  private readonly logger = new Logger(ShopeeOAuthService.name);
  private readonly stateSecret: Uint8Array;
  private readonly crypto: CryptoUtil;

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
  ) {
    this.stateSecret = deriveOAuthStateSecret(this.env.get('ENCRYPTION_KEY'), 'shopee-oauth-state');
    this.crypto = new CryptoUtil(this.env.get('ENCRYPTION_KEY'));
  }

  isConfigured(): boolean {
    return !!(
      this.env.get('SHOPEE_PARTNER_ID') &&
      this.env.get('SHOPEE_PARTNER_KEY') &&
      this.env.get('SHOPEE_REDIRECT_URI')
    );
  }

  baseUrl(): string {
    return this.env.get('SHOPEE_ENV') === 'sandbox'
      ? 'https://partner.test-stable.shopeemobile.com'
      : 'https://partner.shopeemobile.com';
  }

  private signer(): ShopeeSigner {
    return new ShopeeSigner(this.env.get('SHOPEE_PARTNER_ID'), this.env.get('SHOPEE_PARTNER_KEY'));
  }

  async buildAuthUrl(empresaId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new IntegrationException(
        'Shopee não configurada — defina SHOPEE_PARTNER_ID/PARTNER_KEY/REDIRECT_URI',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    // Anexamos nosso state JWT no redirect — Shopee envia de volta como query.
    // Como o redirect aceita querystring arbitrária, a gente embute o state lá.
    const state = await this.signState(empresaId);
    const redirectComState = this.appendState(this.env.get('SHOPEE_REDIRECT_URI'), state);
    const { sign, timestamp } = this.signer().signPublic(PATH_AUTH_PARTNER);
    const params = new URLSearchParams({
      partner_id: this.env.get('SHOPEE_PARTNER_ID'),
      timestamp: String(timestamp),
      sign,
      redirect: redirectComState,
    });
    return `${this.baseUrl()}${PATH_AUTH_PARTNER}?${params}`;
  }

  async processCallback(
    code: string,
    shopId: string,
    state: string,
  ): Promise<{ empresaId: string; shopId: string }> {
    const empresaId = await this.verifyState(state);
    const tokenRes = await this.exchangeCode(code, shopId);
    if (!tokenRes.access_token) {
      throw new IntegrationException(
        `Shopee /auth/token/get sem access_token: ${tokenRes.message ?? '?'}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const creds: ShopeeCredenciais = {
      shopId,
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token,
      expiresAt: Date.now() + tokenRes.expire_in * 1000,
    };
    await this.persistir(empresaId, creds);
    this.logger.log(`Shopee conectada empresa=${empresaId} shop_id=${shopId}`);
    return { empresaId, shopId };
  }

  /** Token válido com refresh transparente. */
  async getCredenciais(empresaId: string): Promise<ShopeeCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'shopee');
    const c = conn.credenciais as Partial<ShopeeCredenciais>;
    if (!c.accessToken || !c.refreshToken || !c.shopId || !c.expiresAt) {
      throw new IntegrationException(
        'Credenciais Shopee incompletas — reconecte o OAuth',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (c.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return c as ShopeeCredenciais;
    }
    this.logger.debug(`Refresh access_token Shopee — empresa=${empresaId}`);
    const tokenRes = await this.refresh(c.refreshToken, c.shopId);
    if (!tokenRes.access_token) {
      throw new IntegrationException(
        `Shopee refresh falhou: ${tokenRes.message ?? '?'}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const novo: ShopeeCredenciais = {
      shopId: c.shopId,
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token ?? c.refreshToken,
      expiresAt: Date.now() + tokenRes.expire_in * 1000,
      mainAccountId: c.mainAccountId,
      region: c.region,
    };
    await this.persistir(empresaId, novo);
    return novo;
  }

  /** Lookup reverso: dado shop_id, retorna empresaId (pro webhook). */
  async resolverPorShopId(shopId: string): Promise<string | null> {
    const conn = await this.prisma.integracaoConexao.findFirst({
      where: { servico: 'shopee', externalAccountId: shopId, ativo: true },
      select: { empresaId: true },
    });
    return conn?.empresaId ?? null;
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private async exchangeCode(code: string, shopId: string): Promise<ShopeeTokenResponse> {
    const { sign, timestamp } = this.signer().signPublic(PATH_TOKEN_GET);
    const url = `${this.baseUrl()}${PATH_TOKEN_GET}?partner_id=${encodeURIComponent(
      this.env.get('SHOPEE_PARTNER_ID'),
    )}&timestamp=${timestamp}&sign=${sign}`;
    return this.postToken(url, {
      code,
      shop_id: Number(shopId),
      partner_id: Number(this.env.get('SHOPEE_PARTNER_ID')),
    });
  }

  private async refresh(refreshToken: string, shopId: string): Promise<ShopeeTokenResponse> {
    const { sign, timestamp } = this.signer().signPublic(PATH_REFRESH);
    const url = `${this.baseUrl()}${PATH_REFRESH}?partner_id=${encodeURIComponent(
      this.env.get('SHOPEE_PARTNER_ID'),
    )}&timestamp=${timestamp}&sign=${sign}`;
    return this.postToken(url, {
      refresh_token: refreshToken,
      shop_id: Number(shopId),
      partner_id: Number(this.env.get('SHOPEE_PARTNER_ID')),
    });
  }

  private async postToken(url: string, body: unknown): Promise<ShopeeTokenResponse> {
    try {
      const res = await this.http.post<ShopeeTokenResponse>(url, {
        body,
        integration: 'shopee',
        redactKeys: ['code', 'access_token', 'refresh_token', 'partner_id'],
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
          `Shopee /auth HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }

  private async persistir(empresaId: string, creds: ShopeeCredenciais): Promise<void> {
    const enc = this.crypto.encrypt(JSON.stringify(creds));
    await this.prisma.integracaoConexao.upsert({
      where: { empresaId_servico: { empresaId, servico: 'shopee' } },
      update: {
        credenciais: enc,
        ativo: true,
        errosRecentes: 0,
        externalAccountId: creds.shopId,
      },
      create: {
        empresaId,
        servico: 'shopee',
        ativo: true,
        credenciais: enc,
        externalAccountId: creds.shopId,
      },
    });
    await this.integracoes.registrarSyncOk(empresaId, 'shopee').catch(() => undefined);
  }

  private appendState(redirectUri: string, state: string): string {
    const u = new URL(redirectUri);
    u.searchParams.set('state', state);
    return u.toString();
  }

  private signState(empresaId: string): Promise<string> {
    return signOAuthState(this.stateSecret, { eid: empresaId });
  }

  private verifyState(state: string): Promise<string> {
    return verifyOAuthState(this.stateSecret, state, 'eid');
  }
}
