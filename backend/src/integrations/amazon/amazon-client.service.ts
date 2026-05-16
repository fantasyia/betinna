import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { AmazonLwaService } from './amazon-lwa.service';
import {
  AMAZON_SPAPI_HOSTS,
  AMAZON_SPAPI_SANDBOX_HOSTS,
  type AmazonRegion,
} from './amazon.types';

/**
 * HTTP client low-level pra Amazon SP-API.
 *
 * Cada request:
 *  - Resolve access_token via AmazonLwaService (refresh transparente)
 *  - Adiciona header `x-amz-access-token: <access_token>` (Amazon removeu AWS
 *    Sigv4 em 10/2023 — não precisa mais assinar)
 *  - Usa host correto por região (NA/EU/FE) + sandbox toggle
 *
 * Amazon retorna erros em corpo `{ errors: [{ code, message, details }] }`
 * com HTTP 4xx — convertemos pra IntegrationException com detalhe.
 *
 * Rate limit: tipicamente x-amzn-RateLimit-Limit/Retry-After — o
 * HttpClientService já honra Retry-After por padrão.
 */
@Injectable()
export class AmazonClientService {
  private readonly logger = new Logger(AmazonClientService.name);

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
    private readonly lwa: AmazonLwaService,
  ) {}

  get baseUrl(): string {
    const region = this.env.get('AMAZON_SP_API_REGION') as AmazonRegion;
    const sandbox = this.env.get('AMAZON_SANDBOX');
    const hosts = sandbox ? AMAZON_SPAPI_SANDBOX_HOSTS : AMAZON_SPAPI_HOSTS;
    return `https://${hosts[region]}`;
  }

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
    return this.lwa.getCredenciais(empresaId);
  }

  /** Marketplace ID configurado no env (default Brasil). */
  get marketplaceId(): string {
    return this.env.get('AMAZON_MARKETPLACE_ID');
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    empresaId: string,
    path: string,
    query: Record<string, string | number | undefined>,
    body?: unknown,
  ): Promise<T> {
    const creds = await this.lwa.getCredenciais(empresaId);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
    const url = `${this.baseUrl}${path}${qs.toString() ? `?${qs}` : ''}`;
    try {
      const res = await this.http.request<T>(method, url, {
        headers: {
          'x-amz-access-token': creds.accessToken,
          // Amazon recomenda enviar user-agent identificável
          'user-agent': 'Betinna.ai/0.1 (Language=TypeScript)',
        },
        body,
        integration: 'amazon',
        redactKeys: ['x-amz-access-token', 'authorization'],
        retries: 1,
        timeoutMs: 30_000,
      });
      return res.data;
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail = this.formatErrorBody(err.body);
        throw new IntegrationException(
          `Amazon SP-API ${method} ${path} HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }

  private formatErrorBody(body: unknown): string {
    if (typeof body !== 'object' || body === null) {
      return String(body ?? '').slice(0, 400);
    }
    const b = body as { errors?: Array<{ code?: string; message?: string }> };
    if (Array.isArray(b.errors)) {
      return b.errors
        .map((e) => `${e.code ?? '?'}: ${e.message ?? ''}`)
        .join(' | ')
        .slice(0, 400);
    }
    return JSON.stringify(body).slice(0, 400);
  }
}
