import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { TinyOAuthService } from './tiny-oauth.service';

/**
 * Cliente HTTP da API v3 do Tiny (Olist). REST/JSON de verdade — diferente do
 * ERP, que era RPC sobre POST com `faultstring` dentro de HTTP 200.
 *
 * Responsabilidades: resolver o access_token da empresa (renovando se preciso),
 * montar a URL, e traduzir erro HTTP em `IntegrationException` preservando o
 * status pra quem chama decidir se retenta.
 *
 * **Rate limit** é por CONTA do Tiny, não por aplicativo — se o cliente tiver
 * outra integração ativa lá, os dois dividem o mesmo teto. Por isso o
 * `X-RateLimit-Remaining` é observado e logado quando aperta: quando começar a
 * bater no teto, o sinal já vai estar no log em vez de virar 429 misterioso.
 */
@Injectable()
export class TinyClientService {
  private readonly logger = new Logger(TinyClientService.name);
  /** Abaixo disso, loga aviso — dá tempo de reagir antes do 429. */
  private static readonly ALERTA_RESTANTE = 10;

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
    private readonly oauth: TinyOAuthService,
  ) {}

  get<T>(empresaId: string, caminho: string, query?: Record<string, string | number | undefined>) {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return this.request<T>(empresaId, 'get', qs ? `${caminho}?${qs}` : caminho);
  }

  post<T>(empresaId: string, caminho: string, body: unknown) {
    return this.request<T>(empresaId, 'post', caminho, body);
  }

  put<T>(empresaId: string, caminho: string, body: unknown) {
    return this.request<T>(empresaId, 'put', caminho, body);
  }

  /**
   * 429 é a ÚNICA falha que a escrita re-tenta.
   *
   * O `retries: 0` do POST/PUT abaixo é proposital: timeout e 5xx podem ter
   * sido processados do outro lado, e repetir criaria pedido duplicado. **429
   * não tem essa dúvida** — o servidor RECUSOU a requisição, nada rodou. Não
   * re-tentar transformava rajada em erro na cara do usuário: medido em 03/09,
   * subir proposta pro ERP morreu com `POST /contatos HTTP 429` logo depois de
   * uma varredura de produtos.
   */
  private static readonly TENTATIVAS_429 = 3;
  private static readonly ESPERA_429_MS = 3000;

  private async request<T>(
    empresaId: string,
    metodo: 'get' | 'post' | 'put',
    caminho: string,
    body?: unknown,
  ): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await this.requestUmaVez<T>(empresaId, metodo, caminho, body);
      } catch (err) {
        const ehLimite = err instanceof IntegrationException && /HTTP 429/.test(err.message);
        if (!ehLimite || tentativa >= TinyClientService.TENTATIVAS_429) throw err;
        const espera = TinyClientService.ESPERA_429_MS * tentativa;
        this.logger.warn(
          `[tiny] 429 em ${metodo.toUpperCase()} ${caminho} — nova tentativa em ${espera}ms ` +
            `(${tentativa}/${TinyClientService.TENTATIVAS_429 - 1})`,
        );
        await new Promise((r) => setTimeout(r, espera));
      }
    }
  }

  private async requestUmaVez<T>(
    empresaId: string,
    metodo: 'get' | 'post' | 'put',
    caminho: string,
    body?: unknown,
  ): Promise<T> {
    const { accessToken } = await this.oauth.getAccessToken(empresaId);
    const url = `${this.env.get('TINY_BASE_URL')}${caminho.startsWith('/') ? '' : '/'}${caminho}`;

    try {
      const res =
        metodo === 'get'
          ? await this.http.get<T>(url, {
              headers: { Authorization: `Bearer ${accessToken}` },
              integration: 'tiny',
              timeoutMs: this.env.get('TINY_TIMEOUT_MS'),
              retries: 2,
            })
          : await this.http[metodo]<T>(url, {
              body,
              headers: { Authorization: `Bearer ${accessToken}` },
              integration: 'tiny',
              timeoutMs: this.env.get('TINY_TIMEOUT_MS'),
              // Escrita NÃO retenta sozinha: criar pedido duas vezes é pior que
              // falhar uma. Quem chama decide o que fazer com o erro.
              retries: 0,
            });
      this.observarRateLimit(res.headers, caminho);
      return res.data;
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detalhe =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 300)
            : String(err.body ?? '').slice(0, 300);
        throw new IntegrationException(
          `Tiny ${metodo.toUpperCase()} ${caminho} HTTP ${err.status}: ${detalhe}`,
          ErrorCode.INTEGRATION_ERROR,
          err.status,
        );
      }
      throw err;
    }
  }

  private observarRateLimit(headers: Record<string, string>, caminho: string): void {
    // O HttpClientService devolve os headers já em minúsculas.
    const restante = Number(headers['x-ratelimit-remaining'] ?? NaN);
    if (Number.isFinite(restante) && restante <= TinyClientService.ALERTA_RESTANTE) {
      const reset = headers['x-ratelimit-reset'] ?? '?';
      this.logger.warn(
        `[tiny] rate limit apertando: ${restante} req restantes (reset em ${reset}s) — ${caminho}`,
      );
    }
  }
}
