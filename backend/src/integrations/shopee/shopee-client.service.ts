import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { ShopeeOAuthService } from './shopee-oauth.service';
import { ShopeeSigner } from './shopee-signer';

/**
 * HTTP client low-level pra Shopee Open Platform.
 *
 * Aplica automaticamente:
 *  - Resolução de access_token (refresh transparente via ShopeeOAuthService)
 *  - Assinatura `?sign=<hex>` em cada request via ShopeeSigner.signShop
 *  - Query params obrigatórios (partner_id, timestamp, access_token, shop_id)
 *
 * Shopee retorna erros como `{ error: "...", message: "...", request_id }` com
 * HTTP 200 — então a gente trata error no payload, não só no status.
 */
@Injectable()
export class ShopeeClientService {
  private readonly logger = new Logger(ShopeeClientService.name);

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
    private readonly oauth: ShopeeOAuthService,
  ) {}

  /**
   * GET shop-scoped (com sign + access_token + shop_id automáticos).
   * @param path path relativo, ex: '/api/v2/sellerchat/get_message'
   * @param extraQuery campos adicionais da query (não inclua sign/access_token/shop_id/timestamp/partner_id)
   */
  async getShop<T>(
    empresaId: string,
    path: string,
    extraQuery: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    return this.call<T>('GET', empresaId, path, extraQuery);
  }

  /** POST shop-scoped — body vai como JSON; query params idem GET. */
  async postShop<T>(
    empresaId: string,
    path: string,
    body: unknown,
    extraQuery: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    return this.call<T>('POST', empresaId, path, extraQuery, body);
  }

  private async call<T>(
    method: 'GET' | 'POST',
    empresaId: string,
    path: string,
    extraQuery: Record<string, string | number | boolean | undefined>,
    body?: unknown,
  ): Promise<T> {
    const creds = await this.oauth.getCredenciais(empresaId);
    const partnerId = this.env.get('SHOPEE_PARTNER_ID');
    const partnerKey = this.env.get('SHOPEE_PARTNER_KEY');
    const signer = new ShopeeSigner(partnerId, partnerKey);
    const { sign, timestamp } = signer.signShop(path, creds.accessToken, creds.shopId);

    const baseUrl = this.oauth.baseUrl();
    const params = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      access_token: creds.accessToken,
      shop_id: creds.shopId,
      sign,
    });
    for (const [k, v] of Object.entries(extraQuery)) {
      if (v !== undefined) params.append(k, String(v));
    }
    const url = `${baseUrl}${path}?${params}`;

    try {
      const res = await this.http.request<T & { error?: string; message?: string }>(
        method,
        url,
        {
          body,
          integration: 'shopee',
          redactKeys: ['access_token', 'partner_id', 'sign'],
          retries: 1,
          timeoutMs: 30_000,
        },
      );
      // Shopee usa HTTP 200 mesmo com erro no payload
      const data = res.data as { error?: string; message?: string } | undefined;
      if (data && data.error) {
        throw new IntegrationException(
          `Shopee ${method} ${path} (${data.error}): ${data.message ?? '?'}`,
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
          `Shopee ${method} ${path} HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }

  /** Expose pra services consultarem shopId/accessToken sem chamar API. */
  async getCredenciais(empresaId: string) {
    return this.oauth.getCredenciais(empresaId);
  }
}
