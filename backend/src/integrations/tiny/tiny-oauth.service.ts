import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { RedisService } from '@database/redis.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { comLockDeRefresh } from '@shared/utils/refresh-lock.util';
import {
  deriveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
} from '@shared/utils/oauth-state.util';
import type { TinyCredenciais, TinyTokenResponse } from './tiny.types';

/** Margem pra renovar o ACCESS antes de vencer (ele dura 4h). */
const MARGEM_ACCESS_MS = 5 * 60_000;
/**
 * Margem pra o cron renovar por antecedência. O REFRESH dura ~1 dia; renovar
 * quando falta menos de 12h dá duas rodadas de folga antes de virar problema.
 */
export const MARGEM_REFRESH_MS = 12 * 60 * 60_000;

/**
 * OAuth2 do Tiny (Olist) — `authorization_code` + `refresh_token`.
 *
 * **O que faz este diferente dos outros OAuth do sistema:** no ML, Meta e
 * Shopee o refresh dura de 30 dias a 1 ano, então basta renovar sob demanda,
 * quando alguém usa a integração. No Tiny o **refresh vence em 1 dia**. Um fim
 * de semana sem tráfego é suficiente pra conexão morrer sozinha e exigir
 * re-autorização manual no navegador.
 *
 * Daí o desenho ter duas pernas:
 *  1. renovação sob demanda em `getAccessToken` (como os outros), e
 *  2. `TinyTokenRefreshJob`, cron de 3h que renova mesmo sem ninguém usar.
 *
 * Sem a perna 2 a integração não sobrevive a um feriado — e o modo de falha é
 * silencioso, que é o pior tipo: ninguém percebe até um pedido não subir.
 */
@Injectable()
export class TinyOAuthService {
  private readonly logger = new Logger(TinyOAuthService.name);
  private readonly stateSecret: Uint8Array;

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly integracoes: IntegracoesService,
    private readonly redis: RedisService,
  ) {
    this.stateSecret = deriveOAuthStateSecret(this.env.get('ENCRYPTION_KEY'), 'tiny-oauth-state');
  }

  isConfigured(): boolean {
    return !!(
      this.env.get('TINY_CLIENT_ID') &&
      this.env.get('TINY_CLIENT_SECRET') &&
      this.env.get('TINY_REDIRECT_URI')
    );
  }

  async buildAuthUrl(empresaId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new IntegrationException(
        'Tiny não configurado — defina TINY_CLIENT_ID/SECRET/REDIRECT_URI',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.env.get('TINY_CLIENT_ID'),
      redirect_uri: this.env.get('TINY_REDIRECT_URI'),
      scope: 'openid',
      state: await signOAuthState(this.stateSecret, { eid: empresaId }),
    });
    return `${this.env.get('TINY_OAUTH_AUTH_URL')}?${params}`;
  }

  async processCallback(code: string, state: string): Promise<{ empresaId: string }> {
    const empresaId = await verifyOAuthState(this.stateSecret, state, 'eid', (jti, ttl) =>
      // O 1º callback queima o jti — replay do link de autorização não passa.
      this.redis.setNxEx(`oauth:jti:${jti}`, '1', ttl),
    );

    const res = await this.callToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.env.get('TINY_CLIENT_ID'),
        client_secret: this.env.get('TINY_CLIENT_SECRET'),
        redirect_uri: this.env.get('TINY_REDIRECT_URI'),
        code,
      }),
    );
    await this.persistir(empresaId, this.montarCredenciais(res));
    this.logger.log(`Tiny conectado empresa=${empresaId}`);
    return { empresaId };
  }

  /**
   * Access token válido, renovando se preciso. É o ponto único por onde todo
   * service da integração passa antes de bater na API v3.
   */
  async getAccessToken(empresaId: string): Promise<TinyCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'tiny');
    const c = conn.credenciais as Partial<TinyCredenciais>;
    if (!c.accessToken || !c.refreshToken || !c.expiresAt) {
      throw new IntegrationException(
        'Credenciais Tiny incompletas — reconecte o ERP',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (c.expiresAt - MARGEM_ACCESS_MS > Date.now()) return c as TinyCredenciais;
    return this.renovar(empresaId, c);
  }

  /**
   * Renova o par de tokens. Serializado por lock: o Keycloak ROTACIONA o
   * refresh a cada troca, então duas renovações concorrentes com o mesmo
   * refresh derrubam a integração (a segunda leva `invalid_grant` e o token
   * bom é sobrescrito pelo ruim).
   */
  async renovar(empresaId: string, atual?: Partial<TinyCredenciais>): Promise<TinyCredenciais> {
    const c =
      atual ??
      ((await this.integracoes.obterCredenciaisInternas(empresaId, 'tiny'))
        .credenciais as Partial<TinyCredenciais>);

    return comLockDeRefresh<TinyCredenciais>(this.redis, `oauth:refresh:tiny:${empresaId}`, {
      reler: async () =>
        (await this.integracoes.obterCredenciaisInternas(empresaId, 'tiny'))
          .credenciais as unknown as TinyCredenciais,
      valida: (cred) => Boolean(cred?.expiresAt && cred.expiresAt - MARGEM_ACCESS_MS > Date.now()),
      renovar: async () => {
        // DOUBLE-CHECK dentro do lock, descartando o cache de 5min do
        // IntegracoesService: se outro processo renovou enquanto disputávamos o
        // lock, o refresh que temos em mãos já foi rotacionado e usá-lo devolve
        // invalid_grant — matando a conexão até alguém reconectar na mão.
        this.integracoes.descartarCacheDeCredenciais(empresaId, 'tiny');
        const fresco = (await this.integracoes.obterCredenciaisInternas(empresaId, 'tiny'))
          .credenciais as Partial<TinyCredenciais>;
        if (fresco?.expiresAt && fresco.expiresAt - MARGEM_ACCESS_MS > Date.now()) {
          return fresco as TinyCredenciais;
        }

        const refresh = (fresco?.refreshToken ?? c.refreshToken) as string;
        const res = await this.callToken(
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.env.get('TINY_CLIENT_ID'),
            client_secret: this.env.get('TINY_CLIENT_SECRET'),
            refresh_token: refresh,
          }),
        ).catch(async (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (/invalid_grant/i.test(msg)) {
            // O refresh morreu (venceu ou foi rotacionado). Sem marcar
            // desconectado, o cache seguiria servindo credencial morta por 5min
            // e toda chamada falharia com o mesmo erro sem explicação na tela.
            this.integracoes.descartarCacheDeCredenciais(empresaId, 'tiny');
            await this.integracoes
              .marcarDesconectado(
                empresaId,
                'tiny',
                'refresh_token do Tiny expirou (dura 1 dia) — reconecte o ERP',
              )
              .catch(() => undefined);
          }
          throw err;
        });

        const novo = this.montarCredenciais(res);
        await this.persistir(empresaId, novo);
        this.logger.debug(`Tiny: tokens renovados empresa=${empresaId}`);
        return novo;
      },
    });
  }

  private montarCredenciais(res: TinyTokenResponse): TinyCredenciais {
    const agora = Date.now();
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      expiresAt: agora + res.expires_in * 1000,
      // Default de 1 dia = o documentado, pra o cron ter um prazo pra vigiar
      // mesmo se o Keycloak omitir o campo.
      refreshExpiresAt: agora + (res.refresh_expires_in ?? 86_400) * 1000,
      renovadoEm: agora,
    };
  }

  private async persistir(empresaId: string, creds: TinyCredenciais): Promise<void> {
    await this.integracoes.salvarCredenciaisInternas(
      empresaId,
      'tiny',
      creds as unknown as Record<string, unknown>,
      // O token do Tiny não devolve id de conta (o Keycloak só devolve os
      // tokens). O client_id serve de identificador estável da conexão — é o
      // que distingue "conectado por qual aplicativo" se um dia houver mais de um.
      this.env.get('TINY_CLIENT_ID'),
    );
  }

  private async callToken(params: URLSearchParams): Promise<TinyTokenResponse> {
    try {
      const res = await this.http.post<TinyTokenResponse>(this.env.get('TINY_OAUTH_TOKEN_URL'), {
        body: params,
        integration: 'tiny',
        redactKeys: ['client_secret', 'code', 'refresh_token', 'access_token'],
        retries: 2,
      });
      if (!res.data?.access_token) {
        throw new IntegrationException('Tiny /token sem access_token', ErrorCode.INTEGRATION_ERROR);
      }
      return res.data;
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detalhe =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 300)
            : String(err.body ?? '').slice(0, 300);
        // `upstreamStatus` preservado: quem trata acima precisa distinguir 400
        // invalid_grant (reconectar) de 5xx do Keycloak (só tentar de novo).
        throw new IntegrationException(
          `Tiny /token HTTP ${err.status}: ${detalhe}`,
          ErrorCode.INTEGRATION_ERROR,
          err.status,
        );
      }
      throw err;
    }
  }
}
