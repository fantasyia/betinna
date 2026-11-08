import { HttpStatus, Injectable } from '@nestjs/common';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { AppException, IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { assinarShein } from './shein-assinatura';

export const SHEIN_API = 'https://openapi.sheincorp.com';

/**
 * Limite de taxa da Shein (HTTP 429 / openapi00006). Espera e tenta de novo;
 * a assinatura leva o timestamp, então cada tentativa assina de novo.
 * Sentry 07/11: 10 consultas desistiam na 1ª recusa e viravam erro 502.
 */
export const ESPERAS_LIMITE_SHEIN_MS = [2_000, 4_000, 8_000];

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
  [extra: string]: unknown;
}

/**
 * Identificadores que a Shein devolve pra achar a chamada no suporte (#02,
 * 07/11: inscrição com 3011 e nada pra levar ao chamado). Pega do envelope
 * tudo que não é code/msg/info e os cabeçalhos com cara de id de rastreio.
 */
export function rastreioShein(
  envelope: Record<string, unknown> | null,
  cabecalhos: Headers,
): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(envelope ?? {})) {
    if (['code', 'msg', 'info'].includes(k) || v === null || v === undefined) continue;
    r[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  cabecalhos.forEach((v, k) => {
    if (/trace|request-?id/i.test(k)) r[`header:${k}`] = v;
  });
  return r;
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

  /**
   * Webhook: acha a empresa pelo appid (e openKeyId da loja, quando vier) do
   * aviso. Poucas conexões Shein — decifra uma a uma e compara.
   */
  async resolverPorChaves(
    appId: string,
    openKeyId: string | undefined,
  ): Promise<{ empresaId: string; appSecret: string } | null> {
    const conexoes = await this.integracoes.listarAtivasPorServico('shein');
    for (const { empresaId } of conexoes) {
      const c = await this.credenciais(empresaId).catch(() => null);
      if (!c || c.appId !== appId) continue;
      if (openKeyId && c.openKeyId !== openKeyId) continue;
      return { empresaId, appSecret: c.appSecret };
    }
    return null;
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
    const { openKeyId, secretKey } = c;
    return this.chamar<T>(path, body, () => {
      const { timestamp, assinatura } = assinarShein(openKeyId, secretKey, path);
      return {
        'x-lt-openKeyId': openKeyId,
        'x-lt-timestamp': timestamp,
        'x-lt-signature': assinatura,
      };
    });
  }

  /**
   * ESCRITA assinada com as chaves da loja, devolvendo o rastreio da Shein
   * junto da resposta. Sem nova tentativa de propósito: repetir uma inscrição
   * ou um preço que a Shein pode ter gravado é pior que falhar.
   */
  async postRastreado<T>(
    empresaId: string,
    path: string,
    body: unknown,
  ): Promise<{ info: T; rastreio: Record<string, string> }> {
    const c = await this.credenciais(empresaId);
    if (!c.openKeyId || !c.secretKey) {
      throw new IntegrationException(
        'Loja da Shein ainda não autorizada — clique em "Autorizar a loja" em Integrações',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const { timestamp, assinatura } = assinarShein(c.openKeyId, c.secretKey, path);
    const r = await fetch(`${SHEIN_API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        language: 'pt-br',
        'x-lt-openKeyId': c.openKeyId,
        'x-lt-timestamp': timestamp,
        'x-lt-signature': assinatura,
      },
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
    const rastreio = rastreioShein(j, r.headers);
    if (!r.ok || !j || String(j.code) !== '0') {
      throw new IntegrationException(
        `Shein ${path} HTTP ${r.status}: ${j ? `${j.code} ${j.msg ?? ''}` : texto.slice(0, 200)}` +
          ` · rastreio ${JSON.stringify(rastreio)}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return { info: j.info as T, rastreio };
  }

  /** POST assinado com o par do APLICATIVO (só a troca do token temporário). */
  async postApp<T>(appId: string, appSecret: string, path: string, body: unknown): Promise<T> {
    return this.chamar<T>(path, body, () => {
      const { timestamp, assinatura } = assinarShein(appId, appSecret, path);
      return { 'x-lt-appid': appId, 'x-lt-timestamp': timestamp, 'x-lt-signature': assinatura };
    });
  }

  private async chamar<T>(
    path: string,
    body: unknown,
    cab: () => Record<string, string>,
    esperas: readonly number[] = ESPERAS_LIMITE_SHEIN_MS,
  ): Promise<T> {
    for (let tentativa = 0; ; tentativa++) {
      const r = await fetch(`${SHEIN_API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8', language: 'pt-br', ...cab() },
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
      if (r.status === 429 || String(j?.code) === 'openapi00006') {
        if (tentativa < esperas.length) {
          await new Promise((ok) => setTimeout(ok, esperas[tentativa]));
          continue;
        }
        // 429 não é bug nosso: vai pro chamador como 429 (aviso), não 502 no Sentry.
        throw new AppException(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          'Limite de consultas da Shein — tente de novo em alguns minutos',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return this.envelope<T>(path, r, j, texto);
    }
  }

  private envelope<T>(path: string, r: Response, j: Envelope<T> | null, texto: string): T {
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
