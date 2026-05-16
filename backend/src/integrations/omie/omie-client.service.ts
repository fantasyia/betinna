import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { OmieDemo } from './omie.demo';
import type {
  OmieFault,
  OmieIncluirPedidoParam,
  OmieIncluirPedidoResponse,
  OmieListarClientesResponse,
  OmieListarProdutosResponse,
  OmieRequestEnvelope,
} from './omie.types';

interface OmieCredenciais {
  appKey: string;
  appSecret: string;
}

/**
 * Cliente low-level da API OMIE.
 *
 * Características:
 *  - Resolve credenciais por empresa via IntegracoesService
 *  - Cai para credenciais do env quando IntegracoesService não tem configuração
 *  - Modo demo: retorna dados mockados sem chamar API real
 *  - Trata `faultstring`/`faultcode` da OMIE como erro (mesmo HTTP 200)
 *  - Paginação automática (`listarTodos` itera todas as páginas)
 *
 * Os métodos higher-level (sync de clientes, push de pedidos) ficam em
 * services separados (`OmieClientesService`, `OmiePedidosService`).
 */
@Injectable()
export class OmieClientService {
  private readonly logger = new Logger(OmieClientService.name);
  private readonly demo = new OmieDemo();

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
    private readonly integracoes: IntegracoesService,
  ) {}

  /** True se o sistema está em modo demo. */
  isDemoMode(): boolean {
    return this.env.get('OMIE_DEMO_MODE') === true;
  }

  /**
   * Resolve credenciais OMIE da empresa.
   * Ordem de precedência:
   *  1. IntegracaoConexao (por empresa) — preferida
   *  2. Variáveis de ambiente (OMIE_APP_KEY/OMIE_APP_SECRET) — fallback
   */
  private async resolverCredenciais(empresaId: string): Promise<OmieCredenciais> {
    if (this.isDemoMode()) {
      return { appKey: 'DEMO_KEY', appSecret: 'DEMO_SECRET' };
    }

    try {
      const conexao = await this.integracoes.obterCredenciaisInternas(empresaId, 'omie');
      const c = conexao.credenciais as { appKey?: string; appSecret?: string };
      if (c.appKey && c.appSecret) {
        return { appKey: c.appKey, appSecret: c.appSecret };
      }
    } catch {
      // Fallback ao env
    }

    const envKey = this.env.get('OMIE_APP_KEY');
    const envSecret = this.env.get('OMIE_APP_SECRET');
    if (envKey && envSecret) {
      return { appKey: envKey, appSecret: envSecret };
    }
    throw new IntegrationException(
      'Credenciais OMIE não configuradas para esta empresa nem no ambiente',
      ErrorCode.INTEGRATION_ERROR,
    );
  }

  /**
   * Faz chamada genérica à API OMIE. Use métodos específicos sempre que possível.
   *
   * @param resource Caminho relativo (ex: "geral/clientes/")
   * @param call     Nome do método OMIE (ex: "ListarClientes")
   * @param param    Único objeto que vai dentro de `param: [...]`
   */
  async chamar<TResp, TParam = unknown>(
    empresaId: string,
    resource: string,
    call: string,
    param: TParam,
  ): Promise<TResp> {
    const creds = await this.resolverCredenciais(empresaId);
    const url = `${this.env.get('OMIE_BASE_URL')}/${resource}`;
    const envelope: OmieRequestEnvelope<TParam> = {
      call,
      app_key: creds.appKey,
      app_secret: creds.appSecret,
      param: [param],
    };

    try {
      const res = await this.http.post<unknown>(url, {
        body: envelope,
        timeoutMs: this.env.get('OMIE_TIMEOUT_MS'),
        integration: 'omie',
        redactKeys: ['app_key', 'app_secret'],
        retries: 2,
      });

      // OMIE pode responder 200 com faultstring
      const data = res.data as unknown;
      if (this.isFault(data)) {
        await this.integracoes.registrarSyncErro(empresaId, 'omie').catch(() => {});
        throw new IntegrationException(
          `OMIE.${call}: ${data.faultcode} — ${data.faultstring}`,
          ErrorCode.OMIE_ERROR,
        );
      }

      return data as TResp;
    } catch (err) {
      if (err instanceof IntegrationException) throw err;
      if (err instanceof HttpClientError) {
        await this.integracoes.registrarSyncErro(empresaId, 'omie').catch(() => {});
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 300)
            : String(err.body ?? '').slice(0, 300);
        throw new IntegrationException(
          `OMIE HTTP ${err.status} em ${call}: ${detail}`,
          ErrorCode.OMIE_ERROR,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new IntegrationException(`OMIE ${call} falhou: ${msg}`, ErrorCode.OMIE_ERROR);
    }
  }

  // ─── Métodos de alto nível ────────────────────────────────────────────

  async listarClientes(
    empresaId: string,
    pagina: number,
    registrosPorPagina = 50,
  ): Promise<OmieListarClientesResponse> {
    if (this.isDemoMode()) return this.demo.listarClientes(pagina);
    return this.chamar<OmieListarClientesResponse>(empresaId, 'geral/clientes/', 'ListarClientes', {
      pagina,
      registros_por_pagina: registrosPorPagina,
      apenas_importado_api: 'N',
    });
  }

  async listarProdutos(
    empresaId: string,
    pagina: number,
    registrosPorPagina = 50,
  ): Promise<OmieListarProdutosResponse> {
    if (this.isDemoMode()) return this.demo.listarProdutos(pagina);
    return this.chamar<OmieListarProdutosResponse>(empresaId, 'geral/produtos/', 'ListarProdutos', {
      pagina,
      registros_por_pagina: registrosPorPagina,
      apenas_importado_api: 'N',
    });
  }

  async incluirPedido(
    empresaId: string,
    param: OmieIncluirPedidoParam,
  ): Promise<OmieIncluirPedidoResponse> {
    if (this.isDemoMode()) {
      this.logger.log(`[demo] IncluirPedido (cliente ${param.cabecalho.codigo_cliente})`);
      return this.demo.incluirPedido();
    }
    return this.chamar<OmieIncluirPedidoResponse>(
      empresaId,
      'produtos/pedido/',
      'IncluirPedido',
      param,
    );
  }

  private isFault(data: unknown): data is OmieFault {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof (data as { faultstring?: unknown }).faultstring === 'string'
    );
  }
}
