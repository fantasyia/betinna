import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { OmieDemo } from './omie.demo';
import type {
  OmieConsultarPedidoResponse,
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
    opts: { escrita?: boolean } = {},
  ): Promise<TResp> {
    const creds = await this.resolverCredenciais(empresaId);
    const url = `${this.env.get('OMIE_BASE_URL')}/${resource}`;
    const envelope: OmieRequestEnvelope<TParam> = {
      call,
      app_key: creds.appKey,
      app_secret: creds.appSecret,
      param: [param],
    };

    // Escrita (ex.: IncluirPedido) NÃO retenta — nem no HTTP nem no fault. O OMIE
    // deduplica por `codigo_pedido_integracao`, então um retry depois dele já ter
    // criado o pedido vira "pedido já cadastrado": um sucesso viraria um erro
    // confuso. Leitura é idempotente e pode retentar à vontade.
    const escrita = opts.escrita === true;

    // Retry exponencial em aplicação: HttpClient já retentaria 5xx/429,
    // mas OMIE devolve faultstring transient (timeouts, manutenção) com HTTP 200.
    // Re-tentamos APENAS quando isRetryableFault — e nunca em escrita.
    const MAX_FAULT_RETRIES = escrita ? 1 : 3;
    let faultAttempt = 0;
    let ultimoFault: { faultcode: string; faultstring: string } | null = null;

    try {
      while (faultAttempt < MAX_FAULT_RETRIES) {
        faultAttempt++;
        const res = await this.http.post<unknown>(url, {
          body: envelope,
          timeoutMs: this.env.get('OMIE_TIMEOUT_MS'),
          integration: 'omie',
          redactKeys: ['app_key', 'app_secret'],
          retries: escrita ? 0 : 2, // escrita não retenta no HTTP (evita duplicar)
        });

        const data = res.data as unknown;
        if (this.isFault(data)) {
          ultimoFault = { faultcode: data.faultcode, faultstring: data.faultstring };
          if (this.isRetryableFault(ultimoFault.faultstring) && faultAttempt < MAX_FAULT_RETRIES) {
            // Backoff exponencial: 500ms, 1500ms, 4500ms
            const wait = 500 * Math.pow(3, faultAttempt - 1);
            this.logger.warn(
              `OMIE.${call} fault retryable (${ultimoFault.faultcode}). Tentativa ${faultAttempt}/${MAX_FAULT_RETRIES}, esperando ${wait}ms`,
            );
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          await this.integracoes.registrarSyncErro(empresaId, 'omie').catch(() => {});
          throw new IntegrationException(
            `OMIE.${call}: ${ultimoFault.faultcode} — ${ultimoFault.faultstring}`,
            ErrorCode.OMIE_ERROR,
          );
        }

        return data as TResp;
      }

      // Esgotou tentativas com fault
      throw new IntegrationException(
        `OMIE.${call} falhou após ${MAX_FAULT_RETRIES} tentativas: ${ultimoFault?.faultcode} — ${ultimoFault?.faultstring}`,
        ErrorCode.OMIE_ERROR,
      );
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
      { escrita: true },
    );
  }

  /**
   * Consulta um pedido no OMIE pelo `codigo_pedido_integracao` (= Pedido.numero).
   * Usado no heal idempotente: se o IncluirPedido falhou mas o pedido JÁ existe
   * lá (resposta perdida num envio anterior), isto devolve o pedido pra reconciliar.
   * É LEITURA — retenta normal em fault transient. Devolve `null` se o pedido não
   * existe / não pôde ser consultado (qualquer fault, ex.: "pedido não encontrado")
   * pra NÃO reconciliar um pedido que na verdade não chegou ao ERP.
   */
  async consultarPedidoPorIntegracao(
    empresaId: string,
    codigoPedidoIntegracao: string,
  ): Promise<OmieIncluirPedidoResponse | null> {
    if (this.isDemoMode()) return null;
    try {
      const resp = await this.chamar<OmieConsultarPedidoResponse>(
        empresaId,
        'produtos/pedido/',
        'ConsultarPedido',
        { codigo_pedido_integracao: codigoPedidoIntegracao },
      );
      const cab = resp.pedido_venda_produto?.cabecalho;
      if (!cab || (cab.codigo_pedido == null && !cab.numero_pedido)) return null;
      return {
        codigo_pedido: cab.codigo_pedido ?? 0,
        codigo_pedido_integracao: cab.codigo_pedido_integracao ?? codigoPedidoIntegracao,
        numero_pedido: cab.numero_pedido,
        codigo_status: 'reconciliado',
        descricao_status: 'Pedido já existente no OMIE (reconciliado)',
      };
    } catch {
      return null;
    }
  }

  private isFault(data: unknown): data is OmieFault {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof (data as { faultstring?: unknown }).faultstring === 'string'
    );
  }

  /**
   * Identifica faults da OMIE que valem a pena retentar.
   *
   * OMIE retorna HTTP 200 com `faultstring` mesmo em erros transients:
   *  - "Sem comunicação com o servidor"
   *  - "Tempo limite excedido"
   *  - "Servidor em manutenção"
   *  - Rate limit ("Aguarde alguns segundos antes de fazer nova requisição")
   *
   * Faults definitivos (NÃO retentar):
   *  - "Cliente não encontrado" (data inconsistente)
   *  - "App Key inválida" (credencial errada)
   *  - "Campo X obrigatório" (validação)
   */
  private isRetryableFault(faultstring: string): boolean {
    const s = faultstring.toLowerCase();
    return (
      s.includes('sem comunicação') ||
      s.includes('tempo limite') ||
      s.includes('timeout') ||
      s.includes('manutenção') ||
      s.includes('manutencao') ||
      s.includes('indisponível') ||
      s.includes('indisponivel') ||
      s.includes('aguarde') ||
      s.includes('limite de requisições') ||
      s.includes('try again') ||
      s.includes('temporariamente')
    );
  }
}
