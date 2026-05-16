import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { TikTokOAuthService } from './tiktok-oauth.service';
import { TikTokSigner } from './tiktok-signer';

const BASE_URL = 'https://open-api.tiktokglobalshop.com';

/**
 * HTTP client low-level pra TikTok Shop Partner API.
 *
 * Aplica automaticamente:
 *  - Resolução de access_token via TikTokOAuthService (refresh transparente)
 *  - HMAC sandwich via TikTokSigner em cada request
 *  - Query params obrigatórios: app_key, timestamp, sign, access_token, shop_id
 *  - Body JSON quando POST/PUT
 *
 * TikTok retorna respostas envelopadas em `{ code, message, data, request_id }`.
 * `code !== 0` indica erro lógico (mesmo com HTTP 200) — convertemos em
 * IntegrationException com detalhe.
 */
@Injectable()
export class TikTokClientService {
  private readonly logger = new Logger(TikTokClientService.name);

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
    private readonly oauth: TikTokOAuthService,
  ) {}

  async get<T>(
    empresaId: string,
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    return this.call<T>('GET', empresaId, path, query);
  }

  async post<T>(
    empresaId: string,
    path: string,
    body: unknown,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    return this.call<T>('POST', empresaId, path, query, body);
  }

  async put<T>(
    empresaId: string,
    path: string,
    body: unknown,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    return this.call<T>('PUT', empresaId, path, query, body);
  }

  async getCredenciais(empresaId: string) {
    return this.oauth.getCredenciais(empresaId);
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    empresaId: string,
    path: string,
    extraQuery: Record<string, string | number | undefined>,
    body?: unknown,
  ): Promise<T> {
    const creds = await this.oauth.getCredenciais(empresaId);
    const appKey = this.env.get('TIKTOK_APP_KEY');
    const appSecret = this.env.get('TIKTOK_APP_SECRET');
    const timestamp = Math.floor(Date.now() / 1000);

    const queryParams: Record<string, string | number | undefined> = {
      app_key: appKey,
      timestamp,
      shop_id: creds.shopId,
      shop_cipher: creds.shopCipher,
      ...extraQuery,
    };
    const bodyStr = body !== undefined ? JSON.stringify(body) : '';
    const signer = new TikTokSigner(appKey, appSecret);
    const sign = signer.sign(path, queryParams, bodyStr);

    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
    }
    url.searchParams.append('sign', sign);
    url.searchParams.append('access_token', creds.accessToken);

    try {
      const res = await this.http.request<T & { code?: number; message?: string }>(
        method,
        url.toString(),
        {
          body,
          integration: 'tiktok',
          redactKeys: ['access_token', 'app_secret', 'sign', 'app_key'],
          retries: 1,
          timeoutMs: 30_000,
          headers: { 'content-type': 'application/json' },
        },
      );
      const data = res.data as { code?: number; message?: string } | undefined;
      if (data && data.code !== undefined && data.code !== 0) {
        throw new IntegrationException(
          `TikTok ${method} ${path} (code=${data.code}): ${data.message ?? '?'}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      return res.data;
    } catch (err) {
      if (err instanceof IntegrationException) throw err;
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 400)
            : String(err.body ?? '').slice(0, 400);
        throw new IntegrationException(
          `TikTok ${method} ${path} HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }
}
