import { Injectable } from '@nestjs/common';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

const API = 'https://api.sellercenter.com.br';
const TENTATIVAS_429 = 2;
/** Milissegundos por segundo de espera; o teste zera. */
export const ESPERA_429 = { ms: 1000 };

/**
 * Cliente da API do Seller Center da Dafiti (v2, OAuth client-credentials).
 * A empresa cola o ID e o Segredo do "Aplicativo OAuth" em Integrações. O
 * token vale 1 h e não tem refresh: pede outro (vários sistemas podem usar o
 * mesmo app ao mesmo tempo). Escrita só pelas rotas de anúncio (07/11).
 */
@Injectable()
export class DafitiClientService {
  private readonly tokens = new Map<string, { token: string; expira: number }>();

  constructor(private readonly integracoes: IntegracoesService) {}

  private async token(empresaId: string): Promise<string> {
    const c = this.tokens.get(empresaId);
    if (c && c.expira > Date.now() + 60_000) return c.token;
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'dafiti');
    const cred = conn.credenciais as { clientId?: string; clientSecret?: string };
    if (!cred.clientId || !cred.clientSecret) {
      throw new IntegrationException(
        'Dafiti sem ID/Segredo do aplicativo OAuth — reconecte em Integrações',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const basic = Buffer.from(`${cred.clientId.trim()}:${cred.clientSecret.trim()}`).toString(
      'base64',
    );
    const r = await fetch(`${API}/oauth/client-credentials`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!r.ok || !j.access_token) {
      throw new IntegrationException(
        `Dafiti recusou o login (HTTP ${r.status}) — confira ID e Segredo`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    this.tokens.set(empresaId, {
      token: j.access_token,
      expira: Date.now() + (j.expires_in ?? 3600) * 1000,
    });
    return j.access_token;
  }

  async get<T>(
    empresaId: string,
    path: string,
    params: Record<string, string | number | string[]> = {},
  ): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
      else qs.append(k, String(v));
    }
    return this.chamar<T>(empresaId, 'GET', `${path}${qs.toString() ? `?${qs}` : ''}`);
  }

  /** Escrita no Seller Center. MEXE NA LOJA. */
  enviar<T = unknown>(
    empresaId: string,
    metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    corpo?: unknown,
  ): Promise<T> {
    return this.chamar<T>(empresaId, metodo, path, corpo);
  }

  /** Limite de taxa (HTTP 429): espera o Retry-After (ou 2 s, 4 s) e tenta de novo. */
  private async chamar<T>(
    empresaId: string,
    metodo: string,
    caminho: string,
    corpo?: unknown,
  ): Promise<T> {
    for (let tentativa = 0; ; tentativa++) {
      const r = await fetch(`${API}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${await this.token(empresaId)}`,
          Accept: 'application/json',
          ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(60_000),
      });
      if (r.status === 429 && tentativa < TENTATIVAS_429) {
        const segundos = Number(r.headers.get('retry-after')) || 2 ** (tentativa + 1);
        await new Promise((ok) => setTimeout(ok, Math.min(segundos, 30) * ESPERA_429.ms));
        continue;
      }
      if (r.status === 401) this.tokens.delete(empresaId);
      if (!r.ok) {
        const texto = (await r.text().catch(() => '')).slice(0, 300);
        throw new IntegrationException(
          `Dafiti ${metodo} ${caminho.split('?')[0]} HTTP ${r.status}: ${texto}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      const texto = await r.text();
      return (texto ? JSON.parse(texto) : null) as T;
    }
  }
}
