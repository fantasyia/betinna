import { Injectable } from '@nestjs/common';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { listaDaResposta } from './magis5-pedidos';

const API = 'https://app.magis5.com.br/v1';
const LIMITE = 100;
const MAX_PAGINAS = 200;

/**
 * Cliente da API do Magis5: lê, e a única escrita é criar o pedido da vitrine.
 * 600 req/min por chave + IP; passou, 429 e espera crescente.
 */
@Injectable()
export class Magis5ClientService {
  constructor(private readonly integracoes: IntegracoesService) {}

  private async chave(empresaId: string): Promise<string> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'magis5');
    const apiKey = (conn.credenciais as { apiKey?: string }).apiKey?.trim();
    if (!apiKey) {
      throw new IntegrationException(
        'Magis5 sem chave — reconecte em Integrações',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return apiKey;
  }

  async get(
    empresaId: string,
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<unknown> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const url = `${API}${path}${qs.toString() ? `?${qs}` : ''}`;
    const chave = await this.chave(empresaId);
    for (let tentativa = 0; ; tentativa++) {
      const r = await fetch(url, {
        headers: { 'X-MAGIS5-APIKEY': chave, Accept: 'application/json' },
        signal: AbortSignal.timeout(60_000),
      });
      if (r.status === 429 && tentativa < 4) {
        await new Promise((ok) => setTimeout(ok, 2_000 * 2 ** tentativa));
        continue;
      }
      if (!r.ok) {
        const corpo = (await r.text().catch(() => '')).slice(0, 300);
        throw new IntegrationException(
          `Magis5 GET ${path} HTTP ${r.status}: ${corpo}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      return r.json();
    }
  }

  async post(empresaId: string, path: string, corpo: unknown): Promise<unknown> {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'X-MAGIS5-APIKEY': await this.chave(empresaId),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const resposta = (await r.text().catch(() => '')).slice(0, 300);
      throw new IntegrationException(
        `Magis5 POST ${path} HTTP ${r.status}: ${resposta}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return r.json().catch(() => null);
  }

  /**
   * Diagnóstico da sessão do usuário (04/11): a rota interna de notas responde 401
   * à chave da API. Devolve só status e nomes de campos, nunca token ou senha.
   */
  async testarSessao(empresaId: string) {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'magis5');
    const { loginUsuario, loginSenha } = conn.credenciais as {
      loginUsuario?: string;
      loginSenha?: string;
    };
    if (!loginUsuario || !loginSenha) return { login: 'sem usuário e senha em Integrações' };
    const r = await fetch(`${API}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ login: loginUsuario, password: loginSenha }),
      signal: AbortSignal.timeout(30_000),
    });
    const corpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const cookies = r.headers.getSetCookie().map((c) => c.split(';')[0]);
    const token = Object.entries(corpo).find(
      ([k, v]) => /token/i.test(k) && typeof v === 'string',
    )?.[1] as string | undefined;
    const lista = async (headers: Record<string, string>) => {
      const x = await fetch('https://app.magis5.com.br/ordermanagement/ordersInvoices/invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...headers,
        },
        body: JSON.stringify({ page: 1, pageSize: 1, status: '', channels: [] }),
        signal: AbortSignal.timeout(30_000),
      });
      return x.status;
    };
    return {
      login: r.status,
      campos: Object.keys(corpo),
      cookies: cookies.map((c) => c.split('=')[0]),
      comCookie: cookies.length ? await lista({ Cookie: cookies.join('; ') }) : null,
      comBearer: token ? await lista({ Authorization: `Bearer ${token}` }) : null,
      comToken: token ? await lista({ Authorization: token }) : null,
    };
  }

  /** Percorre as páginas até vir uma incompleta. */
  async listar(
    empresaId: string,
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<Array<Record<string, unknown>>> {
    const itens: Array<Record<string, unknown>> = [];
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const lista = listaDaResposta(
        await this.get(empresaId, path, { ...params, limit: LIMITE, page }),
      );
      itens.push(...lista);
      if (lista.length < LIMITE) return itens;
    }
    throw new IntegrationException(
      `Magis5 GET ${path}: mais de ${MAX_PAGINAS} páginas`,
      ErrorCode.INTEGRATION_ERROR,
    );
  }
}
