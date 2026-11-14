import { Injectable } from '@nestjs/common';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { MagaluOAuthService } from './magalu-oauth.service';

/** Anúncio, pedido e SAC moram em api.magalu.com. */
const API = 'https://api.magalu.com';
/** Perguntas (/v0/questions) e chat (/v0/conversations) moram em services.magalu.com. */
const SERVICES = 'https://services.magalu.com';

export type MetodoMagalu = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryMagalu = Record<string, string | number | boolean | Array<string | number>>;

/** Host certo pro caminho (doc: baseUrl de cada spec em developers.magalu.com). */
export function hostDoCaminho(caminho: string): string {
  return /^\/v0\/(questions|conversations)(\/|$)/.test(caminho) ? SERVICES : API;
}

/** Monta a query; lista vira parâmetro repetido. */
export function montarQuery(q: QueryMagalu = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Cliente da Open API do Magalu com o token OAuth da empresa. */
@Injectable()
export class MagaluClientService {
  constructor(
    private readonly http: HttpClientService,
    private readonly oauth: MagaluOAuthService,
  ) {}

  get<T>(empresaId: string, caminho: string, query?: QueryMagalu): Promise<T> {
    return this.enviar<T>(empresaId, 'GET', caminho, undefined, query);
  }

  async enviar<T>(
    empresaId: string,
    metodo: MetodoMagalu,
    caminho: string,
    corpo?: unknown,
    query?: QueryMagalu,
  ): Promise<T> {
    const { accessToken } = await this.oauth.getCredenciais(empresaId);
    const url = `${hostDoCaminho(caminho)}${caminho}${montarQuery(query)}`;
    try {
      const res = await this.http.request<T>(metodo, url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        body: corpo,
        integration: 'magalu',
        // Escrita não repete (evita duplicar SKU/preço); leitura tenta de novo.
        retries: metodo === 'GET' ? 2 : 0,
      });
      return res.data;
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 500)
            : String(err.body ?? '').slice(0, 500);
        throw new IntegrationException(
          `Magalu ${metodo} ${caminho} HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
          err.status,
        );
      }
      throw err;
    }
  }
}
