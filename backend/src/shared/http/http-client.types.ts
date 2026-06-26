/**
 * Tipos do HttpClientService compartilhado.
 */

export interface HttpRequestOptions {
  /** Headers extras (Authorization, etc.) */
  headers?: Record<string, string>;
  /** Body JSON-serializável (POST/PUT/PATCH). Strings/Buffers passam direto. */
  body?: unknown;
  /** Timeout em ms. Default 30000 (30s). */
  timeoutMs?: number;
  /**
   * Tentativas no caso de falhas transientes (5xx, network, timeout).
   * Default: 3 em métodos idempotentes (GET/HEAD/OPTIONS/PUT/DELETE) e 0 em
   * POST/PATCH (evita duplicar efeito colateral). Defina explícito pra sobrepor.
   */
  retries?: number;
  /**
   * Base do backoff em ms (cresce 2^n).
   * Default 500ms. Honra `Retry-After` se presente.
   */
  retryBaseMs?: number;
  /**
   * Identificador da integração pra logs (omie, whatsapp, ml, etc).
   * Não vai no payload, só em logs e métricas.
   */
  integration?: string;
  /**
   * Lista de paths/chaves a redact dos logs (default: authorization, token, key).
   */
  redactKeys?: string[];
  /** Não fazer parse JSON da resposta. Default false. */
  rawResponse?: boolean;
}

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  data: T;
  /** Quantas tentativas foram feitas (1 = primeira tentou e deu OK). */
  attempts: number;
  /** Duração total em ms. */
  durationMs: number;
}

/**
 * Redige segredos que viajam na query string (ex.: OAuth da Meta manda client_secret/code/
 * access_token na URL). Sem isso, a URL crua vaza em log/Sentry/message de erro → comprometimento
 * cross-tenant do app secret global e tokens de página. Parse + fallback regex (cobre URL malformada).
 */
const SEGREDOS_QUERY =
  /([?&](?:client_secret|access_token|refresh_token|fb_exchange_token|code|app_secret|api_?key|token|sign|signature|password|secret)=)[^&#\s]*/gi;
export function redactUrl(rawUrl: string): string {
  let out = rawUrl;
  try {
    const u = new URL(rawUrl);
    let mudou = false;
    for (const k of [...u.searchParams.keys()]) {
      if (SEGREDOS_QUERY.test(`?${k}=`)) {
        u.searchParams.set(k, '[REDACTED]');
        mudou = true;
      }
      SEGREDOS_QUERY.lastIndex = 0;
    }
    if (mudou) out = u.toString();
  } catch {
    /* URL não-absoluta (relativa) — segue pro fallback regex */
  }
  return out.replace(SEGREDOS_QUERY, '$1[REDACTED]');
}

/**
 * Erro lançado quando todas as tentativas falham.
 * Diferente do nosso AppException — esse é um erro de transporte/integração.
 */
export class HttpClientError extends Error {
  public readonly url: string;
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    url: string,
    public readonly method: string,
    public readonly attempts: number,
    public readonly cause?: Error,
  ) {
    const urlSegura = redactUrl(url);
    super(`HTTP ${method} ${urlSegura} falhou após ${attempts} tentativa(s) com status ${status}`);
    this.name = 'HttpClientError';
    this.url = urlSegura;
  }
}
