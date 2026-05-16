import { Injectable, Logger } from '@nestjs/common';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { MLOAuthService } from './ml-oauth.service';

const API_BASE = 'https://api.mercadolibre.com';

/**
 * HTTP wrapper de baixo nível pra Mercado Livre.
 *
 * Resolve access_token (com refresh transparente) antes de cada chamada
 * via `MLOAuthService.getAccessToken(empresaId)`.
 *
 * Todos os services específicos (Questions, Messages, Claims, Orders) usam
 * esse client — centraliza tratamento de erro e logging.
 */
@Injectable()
export class MLClientService {
  private readonly logger = new Logger(MLClientService.name);

  constructor(
    private readonly http: HttpClientService,
    private readonly oauth: MLOAuthService,
  ) {}

  async get<T>(empresaId: string, path: string): Promise<T> {
    return this.call<T>('GET', empresaId, path);
  }

  async post<T>(empresaId: string, path: string, body: unknown): Promise<T> {
    return this.call<T>('POST', empresaId, path, body);
  }

  async put<T>(empresaId: string, path: string, body: unknown): Promise<T> {
    return this.call<T>('PUT', empresaId, path, body);
  }

  /** Útil pra pegar credenciais (user_id, etc.) sem trazer o token. */
  async getCredenciais(empresaId: string) {
    return this.oauth.getAccessToken(empresaId);
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    empresaId: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const creds = await this.oauth.getAccessToken(empresaId);
    try {
      const res = await this.http.request<T>(method, `${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        body,
        integration: 'mercadolivre',
        redactKeys: ['authorization'],
        retries: 1,
        timeoutMs: 30_000,
      });
      return res.data;
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 400)
            : String(err.body ?? '').slice(0, 400);
        throw new IntegrationException(
          `ML ${method} ${path} HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }
}
