import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import type {
  MetaInstagramBusinessAccount,
  MetaPage,
  MetaSendTextResult,
  MetaTokenResponse,
} from './meta.types';

/**
 * Wrapper de baixo nível da Meta Graph API.
 *
 * Não conhece nada sobre empresas/Conversation — só fala com a Meta.
 * Quem usa precisa passar o Page Access Token (ou User Token) explicitamente.
 *
 * Cobre o necessário pro fluxo Messenger + IG Direct:
 *  - OAuth (exchange code, long-lived token)
 *  - Listar pages do user, pegar IG vinculado à page
 *  - Enviar mensagem de texto (Messenger e IG usam o mesmo endpoint base)
 */
@Injectable()
export class MetaGraphClientService {
  private readonly logger = new Logger(MetaGraphClientService.name);
  private static readonly OAUTH_DIALOG = 'https://www.facebook.com';

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
  ) {}

  private get baseUrl(): string {
    return `https://graph.facebook.com/${this.env.get('META_GRAPH_API_VERSION')}`;
  }

  /** URL base do diálogo de autorização do Facebook Login. */
  get oauthDialogUrl(): string {
    return `${MetaGraphClientService.OAUTH_DIALOG}/${this.env.get('META_GRAPH_API_VERSION')}/dialog/oauth`;
  }

  // ─── OAuth ───────────────────────────────────────────────────────────

  /** Troca o `code` (Authorization Code Flow) por short-lived user access token. */
  async exchangeCode(code: string, redirectUri: string): Promise<MetaTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.env.get('META_GRAPH_APP_ID'),
      client_secret: this.env.get('META_GRAPH_APP_SECRET'),
      redirect_uri: redirectUri,
      code,
    });
    const res = await this.callExpect<MetaTokenResponse>('GET', `/oauth/access_token?${params}`);
    if (!res.access_token) {
      throw new IntegrationException(
        'Meta /oauth/access_token sem access_token',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return res;
  }

  /** Troca short-lived user token por long-lived (~60 dias). */
  async exchangeLongLived(shortLivedToken: string): Promise<MetaTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.env.get('META_GRAPH_APP_ID'),
      client_secret: this.env.get('META_GRAPH_APP_SECRET'),
      fb_exchange_token: shortLivedToken,
    });
    return this.callExpect<MetaTokenResponse>('GET', `/oauth/access_token?${params}`);
  }

  /** Lista pages que o user administra (já vem com Page Access Token de cada). */
  async listarPages(userAccessToken: string): Promise<MetaPage[]> {
    const params = new URLSearchParams({
      access_token: userAccessToken,
      fields: 'id,name,access_token,category,tasks',
      limit: '100',
    });
    const res = await this.callExpect<{ data: MetaPage[] }>('GET', `/me/accounts?${params}`);
    return res.data ?? [];
  }

  /** Retorna IG Business Account vinculado à Page, se existir. */
  async obterIgVinculadoPage(
    pageId: string,
    pageAccessToken: string,
  ): Promise<MetaInstagramBusinessAccount | null> {
    const params = new URLSearchParams({
      access_token: pageAccessToken,
      fields: 'instagram_business_account{id,username,name}',
    });
    const res = await this.callExpect<{
      instagram_business_account?: MetaInstagramBusinessAccount;
    }>('GET', `/${pageId}?${params}`);
    return res.instagram_business_account ?? null;
  }

  // ─── Envio (Messenger + IG) ──────────────────────────────────────────

  /**
   * Envia texto. Mesmo endpoint pra Messenger e Instagram:
   *  - Messenger: senderEndpointId = pageId (ou 'me' com page token)
   *  - Instagram: senderEndpointId = igUserId
   * Página/conta dona é determinada pelo `pageAccessToken`.
   *
   * Janela de 24h: Meta só permite mensagem standard até 24h após última msg
   * do usuário. Fora disso, exige messaging_tag (HUMAN_AGENT, etc.).
   */
  async enviarTexto(params: {
    senderEndpointId: string;
    pageAccessToken: string;
    recipientPsid: string;
    texto: string;
    /** Default MESSAGE_TAG não usado — só envia se nada informado. Quando 24h estiver vencido, use HUMAN_AGENT. */
    messagingType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
    tag?: string;
  }): Promise<MetaSendTextResult> {
    const body: Record<string, unknown> = {
      recipient: { id: params.recipientPsid },
      message: { text: params.texto },
      messaging_type: params.messagingType ?? 'RESPONSE',
    };
    if (params.tag) body.tag = params.tag;

    const qs = new URLSearchParams({ access_token: params.pageAccessToken });
    return this.callExpect<MetaSendTextResult>(
      'POST',
      `/${encodeURIComponent(params.senderEndpointId)}/messages?${qs}`,
      body,
    );
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private async callExpect<T>(
    method: 'GET' | 'POST',
    pathWithQs: string,
    body?: unknown,
  ): Promise<T> {
    try {
      const url = `${this.baseUrl}${pathWithQs}`;
      const res = await this.http.request<T>(method, url, {
        body,
        integration: 'meta',
        redactKeys: ['access_token', 'client_secret', 'fb_exchange_token', 'code'],
        retries: 1,
      });
      return res.data;
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 400)
            : String(err.body ?? '').slice(0, 400);
        throw new IntegrationException(
          `Meta Graph HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
          err.status, // propaga p/ classificar transitório (5xx/0) vs definitivo (4xx)
        );
      }
      throw err;
    }
  }
}
