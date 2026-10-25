import { Injectable } from '@nestjs/common';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

const API = 'https://api.sellercenter.com.br';

/**
 * Cliente da API do Seller Center da Dafiti (v2, OAuth client-credentials).
 * A empresa cola o ID e o Segredo do "Aplicativo OAuth" em Integrações. O
 * token vale 1 h e não tem refresh: pede outro (vários sistemas podem usar o
 * mesmo app ao mesmo tempo). Só leitura por enquanto.
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
    const url = `${API}${path}${qs.toString() ? `?${qs}` : ''}`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${await this.token(empresaId)}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (r.status === 401) this.tokens.delete(empresaId);
    if (!r.ok) {
      const corpo = (await r.text().catch(() => '')).slice(0, 300);
      throw new IntegrationException(
        `Dafiti GET ${path} HTTP ${r.status}: ${corpo}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return (await r.json()) as T;
  }
}
