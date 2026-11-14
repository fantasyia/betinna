import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { RedisService } from '@database/redis.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import {
  IntegracaoNaoConfiguradaException,
  IntegrationException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import {
  deriveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
} from '@shared/utils/oauth-state.util';
import { comLockDeRefresh } from '@shared/utils/refresh-lock.util';
import type { MagaluCredenciais, MagaluTokenResponse } from './magalu.types';

/** Doc: developers.magalu.com/docs/first-steps/create-an-application/authentication-authorization */
export const MAGALU_AUTH_URL = 'https://id.magalu.com/login';
export const MAGALU_TOKEN_URL = 'https://id.magalu.com/oauth/token';
export const MAGALU_API = 'https://api.magalu.com';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * Escopos pedidos no consentimento quando MAGALU_SCOPES está vazio: anúncio
 * (SKU e preço, ler e escrever; estoque SÓ leitura — vem do Magis5), pedidos e
 * SAC só leitura. Pedir escopo que o cliente do ID Magalu não tem quebra o
 * consentimento — por isso dá pra trocar pelo env sem deploy de código.
 */
export const MAGALU_SCOPES_PADRAO = [
  'open:portfolio-skus-seller:read',
  'open:portfolio-skus-seller:write',
  'open:portfolio-prices-seller:read',
  'open:portfolio-prices-seller:write',
  'open:portfolio-stocks-seller:read',
  'open:order-order-seller:read',
  'open:order-delivery-seller:read',
  'open:order-invoice-seller:read',
  'open:tickets-seller:read',
  'open:ticket-messages-seller:read',
  'services:questions-seller:read',
  'services:conversations-seller:read',
];

/**
 * OAuth 2.0 do ID Magalu (Authorization Code) + tokens por empresa.
 *
 *  1. `buildAuthUrl` → id.magalu.com/login com `choose_tenants=true` (o seller
 *     escolhe a loja) e nosso `state` assinado;
 *  2. callback traz `code` (10 min, uso único) + `state`;
 *  3. troca em /oauth/token (JSON) e persiste em IntegracaoConexao('magalu');
 *  4. `getCredenciais` renova com /oauth/token grant=refresh_token (FORM) com
 *     lock — se o Magalu rotacionar o refresh, dois refresh juntos quebrariam.
 */
@Injectable()
export class MagaluOAuthService {
  private readonly logger = new Logger(MagaluOAuthService.name);
  private readonly stateSecret: Uint8Array;

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly integracoes: IntegracoesService,
    private readonly redis: RedisService,
  ) {
    this.stateSecret = deriveOAuthStateSecret(this.env.get('ENCRYPTION_KEY'), 'magalu-oauth-state');
  }

  isConfigured(): boolean {
    return !!(
      this.env.get('MAGALU_CLIENT_ID') &&
      this.env.get('MAGALU_CLIENT_SECRET') &&
      this.env.get('MAGALU_REDIRECT_URI')
    );
  }

  escopos(): string {
    const env = (this.env.get('MAGALU_SCOPES') ?? '').trim().replace(/\s+/g, ' ');
    return env || MAGALU_SCOPES_PADRAO.join(' ');
  }

  async buildAuthUrl(empresaId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new IntegracaoNaoConfiguradaException(
        'Magalu não configurado — defina MAGALU_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI',
        ErrorCode.INTEGRATION_NOT_CONFIGURED,
      );
    }
    const state = await signOAuthState(this.stateSecret, { eid: empresaId });
    const params = new URLSearchParams({
      client_id: this.env.get('MAGALU_CLIENT_ID'),
      redirect_uri: this.env.get('MAGALU_REDIRECT_URI'),
      scope: this.escopos(),
      response_type: 'code',
      choose_tenants: 'true',
      state,
    });
    return `${MAGALU_AUTH_URL}?${params}`;
  }

  async processCallback(code: string, state: string): Promise<{ empresaId: string; loja: string }> {
    const empresaId = await verifyOAuthState(this.stateSecret, state, 'eid', (jti, ttl) =>
      // SET NX = o 1º callback queima o jti; replay não passa.
      this.redis.setNxEx(`oauth:jti:${jti}`, '1', ttl),
    );
    const tokenRes = await this.chamarToken(
      {
        grant_type: 'authorization_code',
        client_id: this.env.get('MAGALU_CLIENT_ID'),
        client_secret: this.env.get('MAGALU_CLIENT_SECRET'),
        redirect_uri: this.env.get('MAGALU_REDIRECT_URI'),
        code,
      },
      'json',
    );
    if (!tokenRes.refresh_token) {
      throw new IntegrationException(
        'Magalu /oauth/token sem refresh_token',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const creds: MagaluCredenciais = {
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token,
      expiresAt: Date.now() + Number(tokenRes.expires_in || 0) * 1000,
      scope: tokenRes.scope,
      ...(await this.quemSou(tokenRes.access_token)),
    };
    await this.persistir(empresaId, creds, true);
    const loja = creds.sellerNome ?? creds.sellerId ?? creds.tenantId ?? '?';
    this.logger.log(`Magalu conectado empresa=${empresaId} loja=${loja}`);
    return { empresaId, loja };
  }

  /** Token válido, com refresh serializado. */
  async getCredenciais(empresaId: string): Promise<MagaluCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'magalu');
    const c = conn.credenciais as Partial<MagaluCredenciais>;
    if (!c.accessToken || !c.refreshToken || !c.expiresAt) {
      throw new IntegrationException(
        'Credenciais Magalu incompletas — reconecte o OAuth',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (c.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return c as MagaluCredenciais;

    return comLockDeRefresh<MagaluCredenciais>(this.redis, `oauth:refresh:magalu:${empresaId}`, {
      reler: async () => {
        this.integracoes.descartarCacheDeCredenciais(empresaId, 'magalu');
        const conn2 = await this.integracoes.obterCredenciaisInternas(empresaId, 'magalu');
        return conn2.credenciais as unknown as MagaluCredenciais;
      },
      valida: (cred) =>
        Boolean(cred?.expiresAt && cred.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()),
      renovar: async () => {
        // Relê dentro do lock: outro processo pode ter renovado (e rotacionado o refresh).
        this.integracoes.descartarCacheDeCredenciais(empresaId, 'magalu');
        const fresco = (await this.integracoes.obterCredenciaisInternas(empresaId, 'magalu'))
          .credenciais as Partial<MagaluCredenciais>;
        if (fresco?.expiresAt && fresco.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
          return fresco as MagaluCredenciais;
        }
        const base = { ...c, ...fresco } as MagaluCredenciais;
        const tokenRes = await this.chamarToken(
          {
            grant_type: 'refresh_token',
            client_id: this.env.get('MAGALU_CLIENT_ID'),
            client_secret: this.env.get('MAGALU_CLIENT_SECRET'),
            refresh_token: base.refreshToken,
          },
          'form',
        ).catch(async (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          // Refresh morto (revogado/expirado): marca desconectado pra tela avisar.
          if (/invalid_grant|HTTP 401/i.test(msg)) {
            this.integracoes.descartarCacheDeCredenciais(empresaId, 'magalu');
            await this.integracoes
              .marcarDesconectado(
                empresaId,
                'magalu',
                'refresh_token inválido — reconecte o Magalu',
              )
              .catch(() => undefined);
          }
          throw err;
        });
        const novo: MagaluCredenciais = {
          ...base,
          accessToken: tokenRes.access_token,
          // Se o Magalu não mandar refresh novo, o antigo segue valendo.
          refreshToken: tokenRes.refresh_token ?? base.refreshToken,
          expiresAt: Date.now() + Number(tokenRes.expires_in || 0) * 1000,
          scope: tokenRes.scope ?? base.scope,
        };
        await this.persistir(empresaId, novo);
        return novo;
      },
    });
  }

  // ─── Internos ────────────────────────────────────────────────────────

  /**
   * Troca no /oauth/token. A doc manda o `authorization_code` em JSON e o
   * `refresh_token` em x-www-form-urlencoded — respeitamos os dois formatos.
   */
  private async chamarToken(
    campos: Record<string, string>,
    formato: 'json' | 'form',
  ): Promise<MagaluTokenResponse> {
    try {
      const res = await this.http.post<MagaluTokenResponse>(MAGALU_TOKEN_URL, {
        body: formato === 'form' ? new URLSearchParams(campos) : campos,
        integration: 'magalu',
        redactKeys: ['client_secret', 'code', 'refresh_token', 'access_token'],
        retries: 1,
      });
      if (!res.data?.access_token) {
        throw new IntegrationException(
          'Magalu /oauth/token sem access_token',
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
          `Magalu /oauth/token HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
          err.status,
        );
      }
      throw err;
    }
  }

  /** Quem é a loja conectada (GET /seller/v1/portfolios/me). Melhor esforço. */
  private async quemSou(accessToken: string): Promise<Partial<MagaluCredenciais>> {
    try {
      const res = await this.http.get<{
        tenant?: { id?: string };
        seller?: { id?: string; name?: string };
        channel?: { id?: string };
      }>(`${MAGALU_API}/seller/v1/portfolios/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        integration: 'magalu',
        retries: 1,
      });
      return {
        tenantId: res.data?.tenant?.id,
        sellerId: res.data?.seller?.id,
        sellerNome: res.data?.seller?.name,
        channelId: res.data?.channel?.id,
      };
    } catch (err) {
      this.logger.warn(`Magalu portfolios/me: ${String(err)}`);
      return {};
    }
  }

  /** `carimbarConexao` só na volta do consentimento; refresh não carimba. */
  private async persistir(
    empresaId: string,
    creds: MagaluCredenciais,
    carimbarConexao = false,
  ): Promise<void> {
    await this.integracoes.salvarCredenciaisInternas(
      empresaId,
      'magalu',
      creds as unknown as Record<string, unknown>,
      creds.tenantId ?? creds.sellerId ?? '',
      { carimbarConexao },
    );
  }
}
