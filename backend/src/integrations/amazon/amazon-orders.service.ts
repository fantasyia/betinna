import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { AmazonClientService } from './amazon-client.service';
import type {
  AmazonOrder,
  AmazonOrderItemsResponse,
  AmazonOrdersListResponse,
} from './amazon.types';

const PATH_ORDERS_LIST = '/orders/v0/orders';
const PATH_ORDER_ITEMS = (orderId: string) =>
  `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`;

/**
 * Pedidos Amazon. Persiste em `MarketplaceOrder` legacy + cria/atualiza
 * Conversation(MARKETPLACE_AMAZON) por pedido (peerId=`order:<amazonOrderId>`)
 * pra anexar mensagens posteriores.
 *
 * MVP: usa pull periódico. Notifications via SQS fica pra futuro.
 */
@Injectable()
export class AmazonOrdersService {
  private readonly logger = new Logger(AmazonOrdersService.name);

  constructor(
    private readonly amazon: AmazonClientService,
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
  ) {}

  /**
   * Lista pedidos atualizados nas últimas N horas.
   * Amazon limita `CreatedAfter` >= 2 min atrás — usamos `LastUpdatedAfter`.
   */
  async listarRecentes(empresaId: string, horas = 24): Promise<AmazonOrder[]> {
    const lastUpdatedAfter = new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
    const todas: AmazonOrder[] = [];
    let nextToken: string | undefined;
    do {
      const r = await this.amazon.get<AmazonOrdersListResponse>(empresaId, PATH_ORDERS_LIST, {
        MarketplaceIds: this.amazon.marketplaceId,
        LastUpdatedAfter: lastUpdatedAfter,
        MaxResultsPerPage: 100,
        NextToken: nextToken,
      });
      todas.push(...(r.payload?.Orders ?? []));
      nextToken = r.payload?.NextToken;
    } while (nextToken);
    return todas;
  }

  async obter(empresaId: string, amazonOrderId: string): Promise<AmazonOrder> {
    const r = await this.amazon.get<{ payload: AmazonOrder }>(
      empresaId,
      `/orders/v0/orders/${encodeURIComponent(amazonOrderId)}`,
    );
    return r.payload;
  }

  async obterItens(empresaId: string, amazonOrderId: string) {
    const r = await this.amazon.get<AmazonOrderItemsResponse>(
      empresaId,
      PATH_ORDER_ITEMS(amazonOrderId),
    );
    return r.payload?.OrderItems ?? [];
  }

  async processarOrder(empresaId: string, order: AmazonOrder): Promise<void> {
    const externalId = order.AmazonOrderId;
    const compradorNome = order.BuyerInfo?.BuyerName ?? order.ShippingAddress?.Name ?? 'Comprador';
    const total = order.OrderTotal?.Amount ? parseFloat(order.OrderTotal.Amount) : 0;
    // Itens (1 chamada extra por pedido — só obtemos quando salvamos novo OU update raro)
    let produtoNome = '';
    let totalItens = 0;
    try {
      const itens = await this.obterItens(empresaId, externalId);
      const primeiro = itens[0];
      produtoNome = primeiro?.Title ?? '';
      totalItens = itens.reduce((s, i) => s + (i.QuantityOrdered ?? 0), 0);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Falha obtendo itens do pedido ${externalId}: ${m}`);
    }

    const existing = await this.prisma.marketplaceOrder.findUnique({
      where: { plataforma_numeroExterno: { plataforma: 'AMAZON', numeroExterno: externalId } },
      select: { id: true },
    });
    const data = {
      empresaId,
      plataforma: 'AMAZON' as const,
      numeroExterno: externalId,
      comprador: compradorNome,
      produtoNome,
      quantidade: totalItens,
      valor: total,
      status: order.OrderStatus,
      pedidoEm: new Date(order.PurchaseDate),
    };
    if (existing) {
      await this.prisma.marketplaceOrder.update({
        where: { id: existing.id },
        data: {
          status: data.status,
          valor: data.valor,
          quantidade: data.quantidade,
        },
      });
    } else {
      await this.prisma.marketplaceOrder.create({ data });
    }

    // Garante a Conversation associada ao pedido (vazia, sem mensagens — só
    // pra UI ter onde anexar interações futuras). InboxService.processarMensagemEntrante
    // cria Conversation upserted; usamos uma SYSTEM message com resumo curto.
    await this.inbox.processarMensagemEntrante({
      empresaId,
      canal: 'MARKETPLACE_AMAZON',
      peerId: `order:${externalId}`,
      peerNome: compradorNome,
      peerEmail: order.BuyerInfo?.BuyerEmail,
      tipo: 'SYSTEM',
      conteudo: `Pedido ${externalId} · ${order.OrderStatus} · R$ ${total.toFixed(2)}`,
      externalId: `order:${externalId}:event:${order.LastUpdateDate}`,
      data: new Date(order.LastUpdateDate),
      meta: {
        amazon_order_id: externalId,
        amazon_order_status: order.OrderStatus,
        amazon_marketplace_id: order.MarketplaceId,
        amazon_buyer_email: order.BuyerInfo?.BuyerEmail,
        categoria: 'POS_VENDA',
      },
    });
  }
}
