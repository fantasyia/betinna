import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import {
  IntegrationException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { CryptoUtil } from '@shared/utils/crypto.util';
import type { MLCredenciais, MLTokenResponse, MLUserInfo } from './ml.types';

const AUTH_URL_BR = 'https://auth.mercadolivre.com.br/authorization';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const API_BASE = 'https://api.mercadolibre.com';
const STATE_TTL_MIN = 5;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * OAuth do Mercado Livre + gerenciamento automático de tokens.
 *
 * Refresh é proativo: `getAccessToken(empresaId)` checa expiração antes de
 * cada uso e renova com 60s de margem. Refresh token rotativo (a cada exchange
 * o ML emite um novo refresh_token).
 *
 * Persiste em `IntegracaoConexao(servico='mercadolivre')` com `externalAccountId`
 * = ML user_id (não-cifrado, indexável) pra routing reverso de webhooks.
 */
@Injectable()
export class MLOAuthService {
  private readonly logger = new Logger(MLOAuthService.name);
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
      .update('ml-oauth-state')
      .digest();
    this.stateSecret = new Uint8Array(derived);
    this.crypto = new CryptoUtil(this.env.get('ENCRYPTION_KEY'));
  }

  isConfigured(): boolean {
    return !!(
      this.env.get('ML_CLIENT_ID') &&
      this.env.get('ML_CLIENT_SECRET') &&
      this.env.get('ML_REDIRECT_URI')
    );
  }

  async buildAuthUrl(empresaId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new IntegrationException(
        'Mercado Livre não configurado — defina ML_CLIENT_ID/SECRET/REDIRECT_URI',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const state = await this.signState(empresaId);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.env.get('ML_CLIENT_ID'),
      redirect_uri: this.env.get('ML_REDIRECT_URI'),
      state,
    });
    return `${AUTH_URL_BR}?${params}`;
  }

  async processCallback(code: string, state: string): Promise<{ empresaId: string; userId: string }> {
    const empresaId = await this.verifyState(state);

    const tokenRes = await this.exchangeCode(code);
    const userInfo = await this.fetchUserInfo(tokenRes.access_token);

    const creds: MLCredenciais = {
      userId: String(tokenRes.user_id),
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token,
      expiresAt: Date.now() + tokenRes.expires_in * 1000,
      nickname: userInfo.nickname,
      siteId: userInfo.site_id ?? this.env.get('ML_SITE_ID'),
    };
    await this.persistir(empresaId, creds);

    this.logger.log(
      `ML conectado empresa=${empresaId} user_id=${creds.userId} nick=${creds.nickname ?? '?'}`,
    );
    return { empresaId, userId: creds.userId };
  }

  /**
   * Obtém access_token válido (refresh automático antes de expirar).
   * Chamado por todos os services específicos antes de bater na API ML.
   */
  async getAccessToken(empresaId: string): Promise<MLCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'mercadolivre');
    const c = conn.credenciais as Partial<MLCredenciais>;
    if (!c.accessToken || !c.refreshToken || !c.expiresAt || !c.userId) {
      throw new IntegrationException(
        'Credenciais Mercado Livre incompletas — reconecte o OAuth',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (c.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return c as MLCredenciais;
    }
    // Refresh
    this.logger.debug(`Refresh access_token ML — empresa=${empresaId}`);
    const tokenRes = await this.refreshToken(c.refreshToken);
    const novo: MLCredenciais = {
      userId: c.userId,
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token, // ML emite novo refresh_token a cada exchange
      expiresAt: Date.now() + tokenRes.expires_in * 1000,
      nickname: c.nickname,
      siteId: c.siteId,
    };
    await this.persistir(empresaId, novo);
    return novo;
  }

  /** Lookup reverso: dado user_id ML, retorna empresaId. Usado pelo webhook. */
  async resolverPorUserId(userId: string): Promise<string | null> {
    const conn = await this.prisma.integracaoConexao.findFirst({
      where: { servico: 'mercadolivre', externalAccountId: userId, ativo: true },
      select: { empresaId: true },
    });
    return conn?.empresaId ?? null;
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private async exchangeCode(code: string): Promise<MLTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.env.get('ML_CLIENT_ID'),
      client_secret: this.env.get('ML_CLIENT_SECRET'),
      code,
      redirect_uri: this.env.get('ML_REDIRECT_URI'),
    });
    return this.callToken(params);
  }

  private async refreshToken(refreshToken: string): Promise<MLTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.env.get('ML_CLIENT_ID'),
      client_secret: this.env.get('ML_CLIENT_SECRET'),
      refresh_token: refreshToken,
    });
    return this.callToken(params);
  }

  private async callToken(params: URLSearchParams): Promise<MLTokenResponse> {
    try {
      const res = await this.http.post<MLTokenResponse>(TOKEN_URL, {
        body: params,
        integration: 'mercadolivre',
        redactKeys: ['client_secret', 'code', 'refresh_token', 'access_token'],
        retries: 2,
      });
      if (!res.data?.access_token) {
        throw new IntegrationException(
          'ML /oauth/token sem access_token',
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
          `ML /oauth/token HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }

  private async fetchUserInfo(accessToken: string): Promise<MLUserInfo> {
    const res = await this.http.get<MLUserInfo>(`${API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      integration: 'mercadolivre',
      retries: 1,
    });
    return res.data;
  }

  private async persistir(empresaId: string, creds: MLCredenciais): Promise<void> {
    const enc = this.crypto.encrypt(JSON.stringify(creds));
    await this.prisma.integracaoConexao.upsert({
      where: { empresaId_servico: { empresaId, servico: 'mercadolivre' } },
      update: {
        credenciais: enc,
        ativo: true,
        errosRecentes: 0,
        externalAccountId: creds.userId,
      },
      create: {
        empresaId,
        servico: 'mercadolivre',
        ativo: true,
        credenciais: enc,
        externalAccountId: creds.userId,
      },
    });
    await this.integracoes.registrarSyncOk(empresaId, 'mercadolivre').catch(() => undefined);
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
