import { Injectable, Logger } from '@nestjs/common';
import { TinyClientService } from './tiny-client.service';
import { TinyContatosService } from './tiny-contatos.service';

export interface ItemPedidoTiny {
  /** SKU — a chave que amarra site ↔ ERP ↔ app. */
  sku: string;
  quantidade: number;
  /** Preço praticado NESTA venda. Ausente = usa o preço do cadastro. */
  valorUnitario?: number;
}

export interface PedidoParaTiny {
  cliente: {
    nome: string;
    cpfCnpj?: string;
    email?: string;
    telefone?: string;
  };
  itens: ItemPedidoTiny[];
  /** Número do pedido no site — o que o cliente diz quando liga. */
  numeroPedidoEcommerce?: string;
  /** Id do e-commerce CADASTRADO no ERP (Integrações → e-commerce). Amarra o
   *  pedido ao canal, que é o que faz o ERP tratar a venda como "veio da loja"
   *  nos relatórios e na expedição. Sem ele o pedido entra sem canal. */
  ecommerceId?: number;
  /** O que o CLIENTE pagou de frete (0 quando é frete grátis). */
  valorFrete?: number;
  observacoes?: string;
  /** Marcadores/tags no pedido — ex.: o serviço de envio escolhido. */
  marcadores?: string[];
  /** Ids do ERP; sem eles o Tiny usa o padrão da conta quando permite. */
  depositoId?: number;
  vendedorId?: number;
}

export interface ResultadoPedido {
  id: number;
  numeroPedido?: string | number;
}

/** O que a LISTAGEM de pedidos devolve por item (cabeçalho, sem itens). */
export interface PedidoTinyResumo {
  id: number;
  numeroPedido?: string | number;
  /** 0 aberta · 1 faturada · 2 cancelada · 3 aprovada · 4 preparando envio ·
   *  5 enviada · 6 entregue · 7 pronto p/ envio · 8 dados incompletos ·
   *  9 não entregue. */
  situacao?: number;
  dataCriacao?: string;
}

/** `GET /pedidos/{id}` — o cabeçalho acima MAIS itens, valores e transportador. */
export interface PedidoTinyDetalhe extends PedidoTinyResumo {
  data?: string;
  valorTotalPedido?: number;
  valorTotalProdutos?: number;
  valorDesconto?: number;
  valorFrete?: number;
  observacoes?: string;
  cliente?: {
    id?: number;
    nome?: string;
    codigo?: string;
    cpfCnpj?: string;
    email?: string;
    fone?: string;
    celular?: string;
    cidade?: string;
    uf?: string;
  };
  vendedor?: { id?: number; nome?: string; contato?: { id?: number; nome?: string } };
  transportador?: {
    nome?: string;
    formaEnvio?: { id?: number; nome?: string } | string;
    codigoRastreamento?: string;
    urlRastreamento?: string;
  };
  ecommerce?: { numeroPedidoEcommerce?: string; numeroPedidoCanalVenda?: string };
  itens?: Array<{
    produto?: { id?: number; sku?: string; descricao?: string };
    quantidade?: number;
    valorUnitario?: number;
  }>;
}

/**
 * Cria pedidos no Tiny.
 *
 * É o ponto onde a venda sai do nosso lado e entra no ERP — e daí em diante o
 * ERP manda: separação, nota, etiqueta e rastreio acontecem lá, e voltam pra cá
 * por webhook.
 *
 * **Itens são resolvidos por SKU.** O id interno do Tiny não existe do lado do
 * site nem do CRM; o SKU é o único identificador que as três pontas conhecem.
 * SKU que não existe no ERP derruba o pedido inteiro em vez de criar um pedido
 * incompleto — pedido com item faltando vira nota errada, e nota errada é
 * problema fiscal, não bug de tela.
 */
@Injectable()
export class TinyPedidosService {
  private readonly logger = new Logger(TinyPedidosService.name);

  constructor(
    private readonly client: TinyClientService,
    private readonly contatos: TinyContatosService,
  ) {}

  async criar(empresaId: string, pedido: PedidoParaTiny): Promise<ResultadoPedido> {
    const itens = [];
    for (const item of pedido.itens) {
      const produto = await this.acharPorSku(empresaId, item.sku);
      if (!produto) {
        throw new Error(
          `SKU ${item.sku} não existe no Tiny — pedido NÃO criado (item faltando vira nota errada)`,
        );
      }
      itens.push({
        produto: { id: produto.id },
        quantidade: item.quantidade,
        ...(typeof item.valorUnitario === 'number' ? { valorUnitario: item.valorUnitario } : {}),
      });
    }

    // O Tiny exige `idContato`: cliente é CADASTRO, não texto no pedido. Faz
    // sentido — é o mesmo contato que recebe nota, cobrança e histórico.
    const idContato = await this.resolverContato(empresaId, pedido.cliente);

    const corpo: Record<string, unknown> = {
      // 0 = Aberta. O pedido nasce aberto e caminha pelas situações do Tiny
      // conforme a operação avança — não cabe a nós declarar "aprovado".
      situacao: 0,
      idContato,
      itens,
      ...(pedido.depositoId ? { deposito: { id: pedido.depositoId } } : {}),
      ...(pedido.vendedorId ? { vendedor: { id: pedido.vendedorId } } : {}),
      // ⚠️ Vai ANINHADO em `ecommerce`. Solto no topo, o Tiny aceita a
      // requisição e DESCARTA o campo em silêncio — o pedido nasce sem
      // número de e-commerce e ninguém acha pelo número que o cliente diz.
      ...(pedido.numeroPedidoEcommerce || pedido.ecommerceId
        ? {
            ecommerce: {
              ...(pedido.ecommerceId ? { id: pedido.ecommerceId } : {}),
              ...(pedido.numeroPedidoEcommerce
                ? { numeroPedidoEcommerce: pedido.numeroPedidoEcommerce }
                : {}),
            },
          }
        : {}),
      ...(typeof pedido.valorFrete === 'number' ? { valorFrete: pedido.valorFrete } : {}),
      ...(pedido.observacoes ? { observacoes: pedido.observacoes } : {}),
      ...(pedido.marcadores?.length ? { marcadores: pedido.marcadores } : {}),
    };

    const r = await this.client.post<ResultadoPedido>(empresaId, '/pedidos', corpo);
    this.logger.log(
      `[tiny] pedido criado id=${r?.id} numero=${r?.numeroPedido ?? '?'} ` +
        `(${itens.length} item(ns), ecommerce=${pedido.numeroPedidoEcommerce ?? '-'})`,
    );
    return r;
  }

  /**
   * Acha o contato do cliente ou cria.
   *
   * A regra em si (documento antes de nome, tipo pessoa pelo tamanho do
   * documento) mora no `TinyContatosService` — o cadastro de representante
   * precisa da MESMA regra, e duas cópias significam duas deduplicações, das
   * quais uma vai errar e criar contato duplicado.
   */
  private resolverContato(empresaId: string, cliente: PedidoParaTiny['cliente']): Promise<number> {
    return this.contatos.garantir(empresaId, {
      nome: cliente.nome,
      cpfCnpj: cliente.cpfCnpj,
      email: cliente.email,
      telefone: cliente.telefone,
    });
  }

  /**
   * Cancela o pedido no ERP (situação 2).
   *
   * Sem isto, cancelar aqui só mudava o status local: o ERP seguia com o pedido
   * ATIVO e a sincronização do dia seguinte trazia ele de volta como aberto —
   * o cancelamento se desfazia sozinho, e ninguém entende por quê.
   */
  async cancelar(empresaId: string, idPedido: number): Promise<void> {
    await this.client.put(empresaId, `/pedidos/${idPedido}/situacao`, { situacao: 2 });
    this.logger.log(`[tiny] pedido ${idPedido} cancelado no ERP`);
  }

  /** Consulta um pedido — usado pelo webhook, que nunca acredita no payload. */
  obter(empresaId: string, idPedido: number): Promise<PedidoTinyDetalhe> {
    return this.client.get<PedidoTinyDetalhe>(empresaId, `/pedidos/${idPedido}`);
  }

  /**
   * Lista pedidos do ERP. É o caminho de VOLTA: o que nasceu (ou mudou) lá
   * precisa aparecer aqui.
   *
   * A janela é por data de CRIAÇÃO (`dataInicial`/`dataFinal`, formato
   * `YYYY-MM-DD`). O filtro por atualização existe na API, mas a semântica dele
   * não está documentada o bastante pra ser a única rede — quem cuida do pedido
   * que mudou de situação fora da janela é a busca por número, no sync.
   */
  async listar(
    empresaId: string,
    filtro: {
      dataInicial?: string;
      dataFinal?: string;
      numero?: string | number;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ itens: PedidoTinyResumo[]; total: number }> {
    const r = await this.client.get<{
      itens?: PedidoTinyResumo[];
      paginacao?: { total?: number };
    }>(empresaId, '/pedidos', {
      ...(filtro.dataInicial ? { dataInicial: filtro.dataInicial } : {}),
      ...(filtro.dataFinal ? { dataFinal: filtro.dataFinal } : {}),
      ...(filtro.numero != null ? { numero: filtro.numero } : {}),
      limit: filtro.limit ?? 100,
      offset: filtro.offset ?? 0,
    });
    const itens = r.itens ?? [];
    return { itens, total: r.paginacao?.total ?? itens.length };
  }

  /** Público porque o orçamento resolve item pelo MESMO SKU — uma regra só. */
  async acharPorSku(empresaId: string, sku: string): Promise<{ id: number } | null> {
    const r = await this.client.get<{ itens?: Array<{ id: number; sku?: string }> }>(
      empresaId,
      '/produtos',
      { codigo: sku, limit: 50 },
    );
    // `codigo` é busca, não igualdade: MB-01 casaria dentro de MB-010. A
    // conferência exata evita vender o produto errado.
    return (r.itens ?? []).find((i) => (i.sku ?? '').trim() === sku) ?? null;
  }
}
