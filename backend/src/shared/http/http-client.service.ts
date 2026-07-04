import { Injectable, Logger } from '@nestjs/common';
import { logContext } from '@shared/utils/log-context';
import {
  type HttpRequestOptions,
  type HttpResponse,
  HttpClientError,
  redactUrl,
} from './http-client.types';

/**
 * HTTP client compartilhado por todas as integrações externas.
 *
 * Garante uniformidade em:
 *  - retries com backoff exponencial (honra Retry-After) — só em métodos
 *    idempotentes por padrão; POST/PATCH não retryam salvo opt-in explícito
 *  - timeout via AbortController
 *  - logging estruturado com redação de PII
 *  - métricas (tentativas, duração)
 *
 * Usa native `fetch` (Node 22+). Sem dependência axios.
 */
@Injectable()
export class HttpClientService {
  private readonly logger = new Logger(HttpClientService.name);
  private static readonly DEFAULT_RETRIES = 3;
  private static readonly DEFAULT_TIMEOUT_MS = 30_000;
  private static readonly DEFAULT_RETRY_BASE_MS = 500;
  private static readonly DEFAULT_REDACT_KEYS = [
    'authorization',
    'x-api-key',
    'app_key',
    'app_secret',
    'access_token',
    'refresh_token',
    'token',
    'password',
    'senha',
    'api_key',
  ];

  async request<T = unknown>(
    method: string,
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const {
      headers = {},
      body,
      timeoutMs = HttpClientService.DEFAULT_TIMEOUT_MS,
      retryBaseMs = HttpClientService.DEFAULT_RETRY_BASE_MS,
      integration = 'http',
      redactKeys = [],
      rawResponse = false,
    } = options;

    // Retry automático SÓ em métodos idempotentes (GET/HEAD/OPTIONS/PUT/DELETE).
    // POST/PATCH têm efeito colateral (cria pedido, envia mensagem/e-mail): se o
    // servidor já processou e a resposta se perdeu (5xx/timeout/erro de rede),
    // um retry DUPLICA a operação. Por isso o default deles é 0 — quem sabe que
    // é seguro (ex.: troca/refresh de token OAuth) habilita explícito via `retries`.
    const idempotente = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(method.toUpperCase());
    const retries = options.retries ?? (idempotente ? HttpClientService.DEFAULT_RETRIES : 0);

    const start = Date.now();
    const allRedactKeys = [...HttpClientService.DEFAULT_REDACT_KEYS, ...redactKeys];
    let lastError: { status: number; body: unknown; cause?: Error } | null = null;
    let attempt = 0;

    const maxAttempts = retries + 1;

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const init: RequestInit = {
          method,
          headers: this.normalizeHeaders(headers, body),
          signal: controller.signal,
        };
        if (body !== undefined && body !== null) {
          // Node 22+ aceita Buffer em fetch, mas o tipo BodyInit do TS espera Uint8Array.
          // Buffer extende Uint8Array, então o cast é seguro.
          init.body = this.serializeBody(body) as BodyInit;
        }

        const response = await fetch(url, init);
        clearTimeout(timer);

        const responseHeaders = this.headersToObject(response.headers);
        const status = response.status;

        let data: unknown;
        if (rawResponse) {
          data = await response.text();
        } else {
          const text = await response.text();
          data = text.length === 0 ? null : this.tryParseJson(text);
        }

        const durationMs = Date.now() - start;

        // Retry em 5xx ou 429
        if (status >= 500 || status === 429) {
          if (attempt < maxAttempts) {
            const wait = this.computeBackoff(attempt, retryBaseMs, responseHeaders['retry-after']);
            this.logger.warn(
              `[${integration}] ${method} ${redactUrl(url)} → ${status} (tent ${attempt}/${maxAttempts}). Retry em ${wait}ms`,
            );
            await this.sleep(wait);
            lastError = { status, body: data };
            continue;
          }
          this.logRequest(
            integration,
            method,
            url,
            body,
            allRedactKeys,
            status,
            attempt,
            durationMs,
            'failed',
          );
          throw new HttpClientError(status, data, url, method, attempt);
        }

        // Outros status não-OK não retryam (4xx, etc.)
        if (status >= 400) {
          this.logRequest(
            integration,
            method,
            url,
            body,
            allRedactKeys,
            status,
            attempt,
            durationMs,
            'client_error',
          );
          throw new HttpClientError(status, data, url, method, attempt);
        }

        this.logRequest(
          integration,
          method,
          url,
          body,
          allRedactKeys,
          status,
          attempt,
          durationMs,
          'ok',
        );

        return {
          status,
          ok: response.ok,
          headers: responseHeaders,
          data: data as T,
          attempts: attempt,
          durationMs,
        };
      } catch (err) {
        clearTimeout(timer);
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        const isNetwork =
          err instanceof TypeError ||
          (err as { code?: string } | undefined)?.code === 'ECONNRESET' ||
          (err as { code?: string } | undefined)?.code === 'ETIMEDOUT';

        // Se já é HttpClientError, propaga
        if (err instanceof HttpClientError) throw err;

        if (attempt < maxAttempts && (isAbort || isNetwork)) {
          const wait = this.computeBackoff(attempt, retryBaseMs);
          this.logger.warn(
            `[${integration}] ${method} ${redactUrl(url)} erro de rede (tent ${attempt}/${maxAttempts}): ${(err as Error).message}. Retry em ${wait}ms`,
          );
          await this.sleep(wait);
          lastError = {
            status: 0,
            body: null,
            cause: err instanceof Error ? err : new Error(String(err)),
          };
          continue;
        }

        const durationMs = Date.now() - start;
        this.logRequest(
          integration,
          method,
          url,
          body,
          allRedactKeys,
          0,
          attempt,
          durationMs,
          'network_error',
        );
        throw new HttpClientError(
          0,
          null,
          url,
          method,
          attempt,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    // Saída inalcançável (loop garante exit antes), mas TS quer return.
    throw new HttpClientError(
      lastError?.status ?? 0,
      lastError?.body ?? null,
      url,
      method,
      attempt,
      lastError?.cause,
    );
  }

  // Atalhos
  get<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, options);
  }
  post<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('POST', url, options);
  }
  put<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', url, options);
  }
  patch<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PATCH', url, options);
  }
  delete<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', url, options);
  }

  // ─── helpers privados ─────────────────────────────────────────────────

  private normalizeHeaders(headers: Record<string, string>, body: unknown): Record<string, string> {
    const out: Record<string, string> = {
      accept: 'application/json',
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    if (body !== undefined && body !== null && !out['content-type']) {
      // URLSearchParams = corpo de formulário (OAuth /token do Google/marketplaces
      // exige application/x-www-form-urlencoded). Sem isto, o header ia como
      // application/json e o Google respondia 400 "Invalid JSON payload".
      if (body instanceof URLSearchParams) {
        out['content-type'] = 'application/x-www-form-urlencoded';
      } else if (typeof body === 'string') {
        out['content-type'] = 'text/plain';
      } else {
        out['content-type'] = 'application/json';
      }
    }
    // Propaga requestId pra downstream (cross-service correlation). Útil em
    // integrações que ecoam o header de volta nos logs.
    if (!out['x-request-id']) {
      const ctx = logContext.getStore();
      if (ctx?.requestId) {
        out['x-request-id'] = ctx.requestId;
      }
    }
    return out;
  }

  private serializeBody(body: unknown): string | Buffer | URLSearchParams {
    if (body instanceof URLSearchParams) return body;
    if (Buffer.isBuffer(body)) return body;
    if (typeof body === 'string') return body;
    return JSON.stringify(body);
  }

  private headersToObject(h: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    h.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }

  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Backoff exponencial honrando Retry-After.
   * Retry-After: pode ser segundos (number) ou data HTTP.
   */
  private computeBackoff(attempt: number, baseMs: number, retryAfter?: string): number {
    if (retryAfter) {
      const asNum = Number(retryAfter);
      if (!Number.isNaN(asNum) && asNum > 0) return Math.min(asNum * 1000, 30_000);
      const asDate = Date.parse(retryAfter);
      if (!Number.isNaN(asDate)) {
        const diff = asDate - Date.now();
        if (diff > 0) return Math.min(diff, 30_000);
      }
    }
    const jitter = Math.random() * 200;
    return Math.min(baseMs * 2 ** (attempt - 1) + jitter, 30_000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Loga a requisição com redação de chaves sensíveis (case-insensitive).
   */
  private logRequest(
    integration: string,
    method: string,
    url: string,
    body: unknown,
    redactKeys: string[],
    status: number,
    attempts: number,
    durationMs: number,
    outcome: 'ok' | 'client_error' | 'failed' | 'network_error',
  ): void {
    const safeBody = body !== undefined ? this.redact(body, redactKeys) : undefined;
    const level = outcome === 'ok' ? 'log' : outcome === 'client_error' ? 'warn' : 'error';
    const summary = `[${integration}] ${method} ${redactUrl(url)} → ${status} (${attempts}t, ${durationMs}ms)`;
    if (level === 'log') this.logger.log(summary);
    else if (level === 'warn') this.logger.warn(summary);
    else this.logger.error(summary);

    if (process.env.LOG_LEVEL === 'debug' && safeBody !== undefined) {
      this.logger.debug(`[${integration}] body: ${JSON.stringify(safeBody).slice(0, 500)}`);
    }
  }

  /**
   * Recursivamente redact chaves sensíveis em um objeto.
   * Não muta o original.
   */
  private redact(value: unknown, redactKeys: string[]): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map((v) => this.redact(v, redactKeys));
    }
    const lowerKeys = new Set(redactKeys.map((k) => k.toLowerCase()));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (lowerKeys.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null) {
        out[k] = this.redact(v, redactKeys);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
