import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { TikTokClientService } from './tiktok-client.service';
import type {
  TikTokOrder,
  TikTokOrderListResponse,
} from './tiktok.types';

/**
 * Pedidos TikTok Shop. Persiste em `MarketplaceOrder(plataforma=TIKTOK)`.
 *
 * Endpoints v202309:
 *  - POST /order/202309/orders/search → lista (com filtros no body)
 *  - POST /order/202309/orders/get → detalhe (até 50 ids no body)
 */
@Injectable()
export class TikTokOrdersService {
  private readonly logger = new Logger(TikTokOrdersService.name);

  constructor(
    private readonly tiktok: TikTokClientService,
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
  ) {}

  private get apiVersion(): string {
    return this.env.get('TIKTOK_API_VERSION');
  }

  async listarRecentes(empresaId: string, dias = 7): Promise<string[]> {
    const now = Math.floor(Date.now() / 1000);
    const from = now - dias * 24 * 60 * 60;
    const r = await this.tiktok.post<TikTokOrderListResponse>(
      empresaId,
      `/order/${this.apiVersion}/orders/search`,
      {
        update_time_ge: from,
        update_time_lt: now,
      },
      { page_size: 50 },
    );
    return (r.data?.orders ?? []).map((o) => o.id);
  }

  async obterDetalhes(empresaId: string, orderIds: string[]): Promise<TikTokOrder[]> {
    if (orderIds.length === 0) return [];
    // TikTok aceita até 50 ids por chamada
    const todas: TikTokOrder[] = [];
    for (let i = 0; i < orderIds.length; i += 50) {
      const slice = orderIds.slice(i, i + 50);
      const r = await this.tiktok.post<{
        data: { orders: TikTokOrder[] };
      }>(empresaId, `/order/${this.apiVersion}/orders/get`, { ids: slice });
      todas.push(...(r.data?.orders ?? []));
    }
    return todas;
  }

  async processarOrder(empresaId: string, order: TikTokOrder): Promise<void> {
    const externalId = order.id;
    const total = order.payment?.total_amount ? parseFloat(order.payment.total_amount) : 0;
    const primeiro = order.line_items?.[0];
    const produtoNome = primeiro?.product_name ?? '';
    const totalItens = order.line_items?.length ?? 0;
    const compradorNome = order.recipient_address?.name ?? order.buyer_uid ?? '?';

    const existing = await this.prisma.marketplaceOrder.findUnique({
      where: { plataforma_numeroExterno: { plataforma: 'TIKTOK', numeroExterno: externalId } },
      select: { id: true },
    });
    const data = {
      empresaId,
      plataforma: 'TIKTOK' as const,
      numeroExterno: externalId,
      comprador: compradorNome,
      produtoNome,
      quantidade: totalItens,
      valor: total,
      status: order.status,
      pedidoEm: new Date(order.create_time * 1000),
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

    // Garante Conversation associada (categoria POS_VENDA, sistêmica).
    await this.inbox.processarMensagemEntrante({
      empresaId,
      canal: 'MARKETPLACE_TIKTOK',
      peerId: `order:${externalId}`,
      peerNome: compradorNome,
      peerEmail: order.buyer_email,
      tipo: 'SYSTEM',
      conteudo: `Pedido TikTok ${externalId} · ${order.status} · R$ ${total.toFixed(2)}`,
      externalId: `order:${externalId}:event:${order.update_time}`,
      data: new Date(order.update_time * 1000),
      meta: {
        tiktok_order_id: externalId,
        tiktok_status: order.status,
        categoria: 'POS_VENDA',
      },
    });
  }
}
