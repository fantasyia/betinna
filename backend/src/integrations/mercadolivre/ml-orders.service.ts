import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { MLClientService } from './ml-client.service';
import type { MLOrder } from './ml.types';

/**
 * Pedidos do Mercado Livre.
 *
 * Persiste em `MarketplaceOrder` (modelo legacy, mantido) — não no nosso
 * `Pedido` (que é interno OMIE). Marketplace orders são representados
 * separadamente porque têm ciclo de vida e status próprios.
 */
@Injectable()
export class MLOrdersService {
  private readonly logger = new Logger(MLOrdersService.name);

  constructor(
    private readonly ml: MLClientService,
    private readonly prisma: PrismaService,
  ) {}

  async obter(empresaId: string, orderId: string | number): Promise<MLOrder> {
    return this.ml.get<MLOrder>(empresaId, `/orders/${orderId}`);
  }

  /**
   * Listar pedidos do seller recentes (default últimos 30 dias) — usado pelo
   * cron de fallback.
   */
  async listarRecentes(
    empresaId: string,
    sellerId: string,
    desdeIso?: string,
  ): Promise<MLOrder[]> {
    const desde = desdeIso ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      seller: sellerId,
      'order.date_created.from': desde,
      sort: 'date_desc',
      limit: '50',
    });
    const r = await this.ml.get<{ results: MLOrder[] }>(
      empresaId,
      `/orders/search?${params}`,
    );
    return r.results ?? [];
  }

  /** Upsert do pedido em `MarketplaceOrder`. */
  async processarOrder(empresaId: string, order: MLOrder): Promise<void> {
    const externalId = String(order.id);
    const totalItens = order.order_items.reduce((s, i) => s + i.quantity, 0);
    const primeiroItem = order.order_items[0];
    const produtoNome = primeiroItem?.item?.title ?? '';
    const compradorNome =
      [order.buyer.first_name, order.buyer.last_name].filter(Boolean).join(' ').trim() ||
      order.buyer.nickname ||
      `Comprador ${order.buyer.id}`;

    const existing = await this.prisma.marketplaceOrder.findUnique({
      where: { plataforma_numeroExterno: { plataforma: 'ML', numeroExterno: externalId } },
      select: { id: true },
    });

    const data = {
      empresaId,
      plataforma: 'ML' as const,
      numeroExterno: externalId,
      comprador: compradorNome,
      produtoNome,
      quantidade: totalItens,
      valor: order.total_amount,
      status: this.mapStatus(order.status),
      pedidoEm: new Date(order.date_created),
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
  }

  private mapStatus(mlStatus: string): string {
    // Mantém valor cru pra rastreio + alguns aliases comuns
    return mlStatus;
  }
}
