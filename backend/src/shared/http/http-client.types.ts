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
   * Default 3. Use 0 para desabilitar.
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
 * Erro lançado quando todas as tentativas falham.
 * Diferente do nosso AppException — esse é um erro de transporte/integração.
 */
export class HttpClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly url: string,
    public readonly method: string,
    public readonly attempts: number,
    public readonly cause?: Error,
  ) {
    super(
      `HTTP ${method} ${url} falhou após ${attempts} tentativa(s) com status ${status}`,
    );
    this.name = 'HttpClientError';
  }
}
