import { Injectable } from '@nestjs/common';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { assinarShein } from './shein-assinatura';

export const SHEIN_API = 'https://openapi.sheincorp.com';

/**
 * Credenciais da Shein na conexão da empresa. A empresa cola o ID e o segredo
 * do APLICATIVO (Open Platform); a autorização da loja devolve o openKeyId e o
 * secretKey DA LOJA, que assinam os pedidos. Até 01/11 o formulário chamava
 * os campos do aplicativo de openKeyId/secretKey — por isso a leitura antiga.
 */
export interface SheinCredenciais {
  appId: string;
  appSecret: string;
  openKeyId?: string;
  secretKey?: string;
  supplierId?: string;
}

export function credenciaisShein(c: Record<string, unknown>): SheinCredenciais {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (!s(c.appId)) {
    // Forma antiga: só o par do aplicativo, loja ainda não autorizada.
    return { appId: s(c.openKeyId), appSecret: s(c.secretKey) };
  }
  return {
    appId: s(c.appId),
    appSecret: s(c.appSecret),
    openKeyId: s(c.openKeyId) || undefined,
    secretKey: s(c.secretKey) || undefined,
    supplierId: s(c.supplierId) || undefined,
  };
}

interface Envelope<T> {
  code?: string | number;
  msg?: string;
  info?: T;
}

/** Cliente da Open API da Shein. Só leitura por enquanto (pedidos). */
@Injectable()
export class SheinClientService {
  constructor(private readonly integracoes: IntegracoesService) {}

  async credenciais(empresaId: string): Promise<SheinCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'shein');
    const c = credenciaisShein(conn.credenciais as Record<string, unknown>);
    if (!c.appId || !c.appSecret) {
      throw new IntegrationException(
        'Shein sem o ID e o segredo do aplicativo — conecte em Integrações',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return c;
  }

  /** POST assinado com as chaves DA LOJA. */
  async post<T>(empresaId: string, path: string, body: unknown): Promise<T> {
    const c = await this.credenciais(empresaId);
    if (!c.openKeyId || !c.secretKey) {
      throw new IntegrationException(
        'Loja da Shein ainda não autorizada — clique em "Autorizar a loja" em Integrações',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const { timestamp, assinatura } = assinarShein(c.openKeyId, c.secretKey, path);
    return this.chamar<T>(path, body, {
      'x-lt-openKeyId': c.openKeyId,
      'x-lt-timestamp': timestamp,
      'x-lt-signature': assinatura,
    });
  }

  /** POST assinado com o par do APLICATIVO (só a troca do token temporário). */
  async postApp<T>(appId: string, appSecret: string, path: string, body: unknown): Promise<T> {
    const { timestamp, assinatura } = assinarShein(appId, appSecret, path);
    return this.chamar<T>(path, body, {
      'x-lt-appid': appId,
      'x-lt-timestamp': timestamp,
      'x-lt-signature': assinatura,
    });
  }

  private async chamar<T>(path: string, body: unknown, cab: Record<string, string>): Promise<T> {
    const r = await fetch(`${SHEIN_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', language: 'pt-br', ...cab },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await r.text();
    let j: Envelope<T> | null = null;
    try {
      j = JSON.parse(texto) as Envelope<T>;
    } catch {
      /* corpo não-JSON cai no erro abaixo */
    }
    // Sucesso da Shein é code "0"; qualquer outro código é erro, mesmo com HTTP 200.
    if (!r.ok || !j || String(j.code) !== '0') {
      throw new IntegrationException(
        `Shein ${path} HTTP ${r.status}: ${j ? `${j.code} ${j.msg ?? ''}` : texto.slice(0, 200)}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return j.info as T;
  }
}
