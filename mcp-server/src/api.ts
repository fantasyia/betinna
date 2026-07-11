/**
 * Client HTTP da API do Betinna (rotas /kanban), autenticado com o
 * KanbanApiToken (bkt_...). O token só acessa rotas /kanban — toda regra
 * de permissão e multi-tenant continua valendo no backend.
 */

const API_URL = process.env.BETINNA_API_URL ?? '';
const API_TOKEN = process.env.BETINNA_API_TOKEN ?? '';

if (!API_URL || !API_TOKEN) {
  console.error(
    '[betinna-kanban-mcp] Configure as variáveis BETINNA_API_URL (ex: https://sua-api.up.railway.app) ' +
      'e BETINNA_API_TOKEN (gerado em Quadros → Tokens de API).',
  );
  process.exit(1);
}

const BASE = `${API_URL.replace(/\/+$/, '')}/api/v1`;

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  let json: Envelope<T>;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(`Resposta inválida da API (HTTP ${res.status})`, res.status);
  }

  if (!res.ok || !json.success) {
    const msg = json.error?.message ?? `Erro HTTP ${res.status}`;
    if (res.status === 401) {
      throw new ApiError(`${msg}. O token pode ter sido revogado — gere outro em Quadros → Tokens de API.`, 401);
    }
    throw new ApiError(msg, res.status);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
