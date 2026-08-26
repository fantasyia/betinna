import { Injectable, Logger } from '@nestjs/common';
import { TinyClientService } from './tiny-client.service';

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
  /** Número do pedido no site — é por ele que o webhook volta a casar. */
  numeroPedidoEcommerce?: string;
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

  constructor(private readonly client: TinyClientService) {}

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

    const corpo: Record<string, unknown> = {
      // 0 = Aberta. O pedido nasce aberto e caminha pelas situações do Tiny
      // conforme a operação avança — não cabe a nós declarar "aprovado".
      situacao: 0,
      cliente: {
        nome: pedido.cliente.nome,
        ...(pedido.cliente.cpfCnpj ? { cpfCnpj: pedido.cliente.cpfCnpj } : {}),
        ...(pedido.cliente.email ? { email: pedido.cliente.email } : {}),
        ...(pedido.cliente.telefone ? { fone: pedido.cliente.telefone } : {}),
      },
      itens,
      ...(pedido.depositoId ? { deposito: { id: pedido.depositoId } } : {}),
      ...(pedido.vendedorId ? { vendedor: { id: pedido.vendedorId } } : {}),
      ...(pedido.numeroPedidoEcommerce
        ? { numeroPedidoEcommerce: pedido.numeroPedidoEcommerce }
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

  /** Consulta um pedido — usado pelo webhook, que nunca acredita no payload. */
  obter(empresaId: string, idPedido: number) {
    return this.client.get<Record<string, unknown>>(empresaId, `/pedidos/${idPedido}`);
  }

  private async acharPorSku(empresaId: string, sku: string): Promise<{ id: number } | null> {
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
