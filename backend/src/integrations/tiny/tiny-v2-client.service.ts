import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';

/** Envelope que toda rota da v2 devolve, sempre dentro de HTTP 200. */
export interface TinyV2Retorno {
  status_processamento?: string;
  status?: string;
  codigo_erro?: string | number;
  erros?: unknown;
  registros?: unknown;
  [k: string]: unknown;
}

/**
 * Cliente da API **v2** do Tiny (`api2/*.php`) — outro mundo da v3.
 *
 * Existe por um motivo só: **CONTRATO não existe na v3**. Sondado contra a API
 * real em 05/09: `/contratos`, `/contrato` e `/recorrencias` dão 404 com o mesmo
 * token que lê `/contas-receber` em 200, e a palavra "contrato" não aparece nas
 * 127 rotas do spec. Na v2 existem `contratos.pesquisa.php` (**plural** — o
 * singular dá 404), `contrato.obter.php`, `contrato.incluir.php`,
 * `contrato.alterar.php` e `contrato.adicional.incluir.php`. Não existe
 * excluir nem faturar.
 *
 * Três diferenças que mudam o código:
 *
 * 1. **Token fixo por conta** (`TINY_V2_TOKEN`, gerado no painel), que vai no
 *    CORPO de cada chamada — não é o OAuth da v3. Vazio = contrato desligado.
 * 2. **Form-urlencoded**, não JSON. O objeto vai como string JSON dentro de um
 *    campo (`contrato=<json>`), o que é o mais fácil de errar aqui.
 * 3. **Erro dentro de HTTP 200.** `retorno.status === 'Erro'`; quem só olhasse
 *    o código HTTP acharia que gravou. É o mesmo defeito do RPC do ERP antigo.
 */
@Injectable()
export class TinyV2ClientService {
  private readonly logger = new Logger(TinyV2ClientService.name);
  private static readonly BASE = 'https://api.tiny.com.br/api2';
  /** 429 é a única falha que vale repetir: o servidor RECUSOU, nada rodou. */
  private static readonly TENTATIVAS_429 = 3;
  private static readonly ESPERA_429_MS = 3000;

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpClientService,
  ) {}

  /** Sem token, a integração de contrato está desligada — e nada mais depende dela. */
  get configurado(): boolean {
    return this.env.get('TINY_V2_TOKEN').trim().length > 0;
  }

  /**
   * Chama uma rota da v2 e devolve o `retorno`, já validado.
   *
   * @param rota   nome do arquivo, ex.: `contrato.incluir.php`
   * @param campos campos do corpo além de `token`/`formato` (o objeto vai como
   *               string JSON, ex.: `{ contrato: JSON.stringify({ contrato }) }`)
   */
  async chamar<T extends TinyV2Retorno = TinyV2Retorno>(
    rota: string,
    campos: Record<string, string> = {},
  ): Promise<T> {
    const token = this.env.get('TINY_V2_TOKEN').trim();
    if (!token) {
      throw new IntegrationException(
        'Integração de contrato desligada: TINY_V2_TOKEN não está configurado.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    const retorno = await this.postComRetry<T>(rota, { token, formato: 'json', ...campos });
    const status = String(retorno.status ?? '');
    if (status.toLowerCase() === 'erro' || retorno.codigo_erro) {
      // A v2 esconde a mensagem em três lugares diferentes conforme a rota —
      // por isso o texto do erro carrega o retorno inteiro (truncado). Sem ele,
      // "erro ao criar contrato" não diz qual campo faltou.
      throw new IntegrationException(
        `[tiny v2] ${rota} recusou: ${JSON.stringify(retorno.erros ?? retorno).slice(0, 400)}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return retorno;
  }

  private async postComRetry<T extends TinyV2Retorno>(
    rota: string,
    corpo: Record<string, string>,
  ): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        const res = await this.http.post<{ retorno?: T }>(`${TinyV2ClientService.BASE}/${rota}`, {
          body: new URLSearchParams(corpo),
          integration: 'tiny-v2',
          timeoutMs: this.env.get('TINY_TIMEOUT_MS'),
          // Escrita não retenta sozinha: criar contrato duas vezes é pior que
          // falhar uma (e a v2 não tem DELETE pra desfazer).
          retries: 0,
        });
        return (res.data?.retorno ?? ({} as T)) as T;
      } catch (err) {
        const status = err instanceof HttpClientError ? err.status : 0;
        if (status !== 429 || tentativa >= TinyV2ClientService.TENTATIVAS_429) {
          throw err instanceof HttpClientError
            ? new IntegrationException(
                `[tiny v2] ${rota} HTTP ${err.status}: ${JSON.stringify(err.body ?? '').slice(0, 300)}`,
                ErrorCode.INTEGRATION_ERROR,
              )
            : err;
        }
        const espera = TinyV2ClientService.ESPERA_429_MS * tentativa;
        this.logger.warn(`[tiny v2] 429 em ${rota} — nova tentativa em ${espera}ms`);
        await new Promise((r) => setTimeout(r, espera));
      }
    }
  }
}
