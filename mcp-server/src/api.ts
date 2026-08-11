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
  /** `details` carrega os issues do Zod — é onde mora o motivo REAL do 400. */
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * Achata `error.details` num texto curto e legível.
 *
 * AUDITORIA (média): o MCP descartava `details` e `code`, então TODO erro de
 * validação chegava como "ERRO: Dados inválidos" — sem dizer qual campo, o que
 * transformava cada ajuste de fluxo/card numa adivinhação por tentativa. O Zod
 * manda `[{ path: ['nos',0,'acaoTipo'], message: '...' }]`; é isso que interessa.
 */
function formatarDetalhes(details: unknown): string {
  if (!details) return '';
  if (typeof details === 'string') return ` — ${details}`;
  if (Array.isArray(details)) {
    const linhas = details
      .map((d) => {
        if (typeof d === 'string') return d;
        const o = d as { path?: unknown; message?: unknown; campo?: unknown };
        const caminho = Array.isArray(o.path) ? o.path.join('.') : String(o.campo ?? '');
        const msg = typeof o.message === 'string' ? o.message : JSON.stringify(d);
        return caminho ? `${caminho}: ${msg}` : msg;
      })
      .filter(Boolean);
    // Cap de 5: erro de grafo pode ter dezenas de issues e o resto vira ruído.
    const mostrar = linhas.slice(0, 5).join('; ');
    return linhas.length > 5 ? ` — ${mostrar} (+${linhas.length - 5})` : ` — ${mostrar}`;
  }
  try {
    return ` — ${JSON.stringify(details).slice(0, 400)}`;
  } catch {
    return '';
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** Interpreta a resposta (envelope + erros acionáveis). Compartilhado por JSON e multipart. */
async function interpretar<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  let json: Envelope<T>;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    // Não-JSON (HTML de proxy, 502 do Railway): mostra o começo do corpo — sem
    // isso o operador só via "resposta inválida" e não sabia se era o proxy.
    const corpo = await res
      .clone()
      .text()
      .catch(() => '');
    const trecho = corpo.trim().slice(0, 200).replace(/\s+/g, ' ');
    throw new ApiError(
      `Resposta inválida da API (HTTP ${res.status})${trecho ? ` — ${trecho}` : ''}`,
      res.status,
    );
  }

  if (!res.ok || !json.success) {
    const base = json.error?.message ?? `Erro HTTP ${res.status}`;
    // code + details: sem eles, "Dados inválidos" não diz NADA de acionável.
    const codigo = json.error?.code ? ` [${json.error.code}]` : '';
    const msg = `${base}${codigo}${formatarDetalhes(json.error?.details)}`;
    if (res.status === 401) {
      throw new ApiError(`${msg}. O token pode ter sido revogado — gere outro em Quadros → Tokens de API.`, 401);
    }
    throw new ApiError(msg, res.status);
  }
  return json.data as T;
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
  return interpretar<T>(res);
}

/** POST multipart/form-data — NÃO seta Content-Type (o fetch põe o boundary). */
async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    body: form,
  });
  return interpretar<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  postForm: <T>(path: string, form: FormData) => postForm<T>(path, form),
};
