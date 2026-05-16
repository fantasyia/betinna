import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { CryptoUtil } from '@shared/utils/crypto.util';
import type { AmazonCredenciais, AmazonLwaTokenResponse } from './amazon.types';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const STATE_TTL_MIN = 5;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * Login With Amazon (LWA) — OAuth 2.0 do Selling Partner.
 *
 * Fluxo:
 *  1. `buildAuthUrl(empresaId)` → URL pra Seller Central authorize
 *  2. Amazon redireciona com `spapi_oauth_code`, `selling_partner_id`, `state`
 *  3. `processCallback(code, sellingPartnerId, state)` troca code por
 *     refresh_token (longa-duração) + access_token (1h)
 *  4. `getAccessToken(empresaId)` retorna access_token válido (refresh em 60s
 *     antes de expirar) — usado por todos os services que batem na SP-API
 *
 * Persiste em `IntegracaoConexao(servico='amazon')` com
 * `externalAccountId` = sellingPartnerId pra lookup reverso.
 */
@Injectable()
export class AmazonLwaService {
  private readonly logger = new Logger(AmazonLwaService.name);
  private readonly stateSecret: Uint8Array;
  private readonly crypto: CryptoUtil;

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
  ) {
    const derived = createHash('sha256')
      .update(this.env.get('ENCRYPTION_KEY'))
      .update('amazon-lwa-state')
      .digest();
    this.stateSecret = new Uint8Array(derived);
    this.crypto = new CryptoUtil(this.env.get('ENCRYPTION_KEY'));
  }

  isConfigured(): boolean {
    return !!(
      this.env.get('AMAZON_CLIENT_ID') &&
      this.env.get('AMAZON_CLIENT_SECRET') &&
      this.env.get('AMAZON_APP_ID') &&
      this.env.get('AMAZON_LWA_REDIRECT_URI')
    );
  }

  /**
   * Constrói URL de autorização Seller Central.
   * Note: o `version=beta` é necessário durante draft do app — remova quando
   * publicar em produção.
   */
  async buildAuthUrl(empresaId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new IntegrationException(
        'Amazon SP-API não configurada — defina AMAZON_CLIENT_ID/SECRET/APP_ID/LWA_REDIRECT_URI',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const state = await this.signState(empresaId);
    const params = new URLSearchParams({
      application_id: this.env.get('AMAZON_APP_ID'),
      state,
      version: 'beta',
    });
    return `https://${this.env.get('AMAZON_OAUTH_HOST')}/apps/authorize/consent?${params}`;
  }

  /**
   * Troca o `spapi_oauth_code` por refresh_token + access_token.
   * O `selling_partner_id` vem como query param do redirect — guardamos pra
   * roteamento de notifications futuras.
   */
  async processCallback(
    code: string,
    sellingPartnerId: string,
    state: string,
  ): Promise<{ empresaId: string; sellingPartnerId: string }> {
    const empresaId = await this.verifyState(state);
    const tokenRes = await this.exchangeCode(code);
    if (!tokenRes.refresh_token) {
      throw new IntegrationException(
        'Amazon /auth/o2/token sem refresh_token — confirme scopes do app',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const creds: AmazonCredenciais = {
      sellingPartnerId,
      refreshToken: tokenRes.refresh_token,
      accessToken: tokenRes.access_token,
      expiresAt: Date.now() + tokenRes.expires_in * 1000,
      marketplaceId: this.env.get('AMAZON_MARKETPLACE_ID'),
    };
    await this.persistir(empresaId, creds);
    this.logger.log(`Amazon conectada empresa=${empresaId} selling_partner_id=${sellingPartnerId}`);
    return { empresaId, sellingPartnerId };
  }

  /**
   * Retorna access_token válido. Refresh automático (60s margem).
   * Usado pelo AmazonClientService antes de cada request SP-API.
   */
  async getCredenciais(empresaId: string): Promise<AmazonCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'amazon');
    const c = conn.credenciais as Partial<AmazonCredenciais>;
    if (!c.refreshToken || !c.accessToken || !c.expiresAt || !c.sellingPartnerId) {
      throw new IntegrationException(
        'Credenciais Amazon incompletas — reconecte o OAuth',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (c.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return c as AmazonCredenciais;
    }
    // Refresh
    this.logger.debug(`Refresh access_token Amazon — empresa=${empresaId}`);
    const tokenRes = await this.refresh(c.refreshToken);
    const novo: AmazonCredenciais = {
      sellingPartnerId: c.sellingPartnerId,
      refreshToken: tokenRes.refresh_token ?? c.refreshToken,
      accessToken: tokenRes.access_token,
      expiresAt: Date.now() + tokenRes.expires_in * 1000,
      marketplaceId: c.marketplaceId,
    };
    await this.persistir(empresaId, novo);
    return novo;
  }

  /** Lookup reverso: dado selling_partner_id, retorna empresaId. */
  async resolverPorSellingPartnerId(sellingPartnerId: string): Promise<string | null> {
    const conn = await this.prisma.integracaoConexao.findFirst({
      where: { servico: 'amazon', externalAccountId: sellingPartnerId, ativo: true },
      select: { empresaId: true },
    });
    return conn?.empresaId ?? null;
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private async exchangeCode(code: string): Promise<AmazonLwaTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.env.get('AMAZON_CLIENT_ID'),
      client_secret: this.env.get('AMAZON_CLIENT_SECRET'),
      redirect_uri: this.env.get('AMAZON_LWA_REDIRECT_URI'),
    });
    return this.postToken(params);
  }

  private async refresh(refreshToken: string): Promise<AmazonLwaTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.env.get('AMAZON_CLIENT_ID'),
      client_secret: this.env.get('AMAZON_CLIENT_SECRET'),
    });
    return this.postToken(params);
  }

  private async postToken(body: URLSearchParams): Promise<AmazonLwaTokenResponse> {
    try {
      const res = await this.http.post<AmazonLwaTokenResponse>(LWA_TOKEN_URL, {
        body,
        integration: 'amazon',
        redactKeys: ['client_secret', 'code', 'refresh_token', 'access_token'],
        retries: 2,
      });
      if (!res.data?.access_token) {
        throw new IntegrationException('Amazon LWA sem access_token', ErrorCode.INTEGRATION_ERROR);
      }
      return res.data;
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 300)
            : String(err.body ?? '').slice(0, 300);
        throw new IntegrationException(
          `Amazon LWA HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }

  private async persistir(empresaId: string, creds: AmazonCredenciais): Promise<void> {
    const enc = this.crypto.encrypt(JSON.stringify(creds));
    await this.prisma.integracaoConexao.upsert({
      where: { empresaId_servico: { empresaId, servico: 'amazon' } },
      update: {
        credenciais: enc,
        ativo: true,
        errosRecentes: 0,
        externalAccountId: creds.sellingPartnerId,
      },
      create: {
        empresaId,
        servico: 'amazon',
        ativo: true,
        credenciais: enc,
        externalAccountId: creds.sellingPartnerId,
      },
    });
    await this.integracoes.registrarSyncOk(empresaId, 'amazon').catch(() => undefined);
  }

  private async signState(empresaId: string): Promise<string> {
    return new SignJWT({ eid: empresaId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${STATE_TTL_MIN}m`)
      .setJti(crypto.randomUUID())
      .sign(this.stateSecret);
  }

  private async verifyState(state: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(state, this.stateSecret);
      const eid = (payload as { eid?: unknown }).eid;
      if (typeof eid !== 'string' || eid.length === 0) {
        throw new UnauthorizedException('state inválido', ErrorCode.AUTH_INVALID_TOKEN);
      }
      return eid;
    } catch {
      throw new UnauthorizedException(
        'state inválido ou expirado (CSRF protection)',
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    }
  }
}
