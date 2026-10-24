import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ShopeeClientService } from './shopee-client.service';
import type { ShopeeOrder, ShopeeOrderListResponse } from './shopee.types';
import { custoDosItens, financeiroShopee } from '@modules/pedidos-marketplace/financeiro';
import { situacaoShopee } from '@modules/pedidos-marketplace/situacao';

const PATH_ORDER_LIST = '/api/v2/order/get_order_list';
const PATH_ORDER_DETAIL = '/api/v2/order/get_order_detail';
const ORDER_DETAIL_FIELDS =
  'order_status,buyer_username,total_amount,currency,create_time,update_time,pay_time,ship_by_date,item_list';

/**
 * Pedidos Shopee. Persiste em `MarketplaceOrder` (modelo legacy).
 */
@Injectable()
export class ShopeeOrdersService {
  private readonly logger = new Logger(ShopeeOrdersService.name);

  constructor(
    private readonly shopee: ShopeeClientService,
    private readonly prisma: PrismaService,
  ) {}

  /** Lista pedidos recentes (últimos 15 dias por default — limite da Shopee). */
  async listarRecentes(empresaId: string, dias = 15): Promise<string[]> {
    const now = Math.floor(Date.now() / 1000);
    const from = now - dias * 24 * 60 * 60;
    const r = await this.shopee.getShop<ShopeeOrderListResponse>(empresaId, PATH_ORDER_LIST, {
      time_range_field: 'create_time',
      time_from: from,
      time_to: now,
      page_size: 50,
    });
    return (r.response?.order_list ?? []).map((o) => o.order_sn);
  }

  async obterDetalhes(empresaId: string, orderSns: string[]): Promise<ShopeeOrder[]> {
    if (orderSns.length === 0) return [];
    const r = await this.shopee.getShop<{
      response: { order_list: ShopeeOrder[] };
    }>(empresaId, PATH_ORDER_DETAIL, {
      order_sn_list: orderSns.join(','),
      response_optional_fields: ORDER_DETAIL_FIELDS,
    });
    return r.response?.order_list ?? [];
  }

  async processarOrder(empresaId: string, order: ShopeeOrder): Promise<void> {
    const externalId = order.order_sn;
    const totalItens = order.item_list?.reduce((s, i) => s + i.model_quantity_purchased, 0) ?? 0;
    const primeiro = order.item_list?.[0];
    const produtoNome = primeiro?.item_name ?? '';
    const compradorNome = order.buyer_username ?? '?';

    const existing = await this.prisma.marketplaceOrder.findUnique({
      where: { plataforma_numeroExterno: { plataforma: 'SHOPEE', numeroExterno: externalId } },
      select: { id: true, liquido: true },
    });
    const fin = await this.financeiro(empresaId, order, existing?.liquido ?? null);
    const data = {
      empresaId,
      plataforma: 'SHOPEE' as const,
      numeroExterno: externalId,
      comprador: compradorNome,
      produtoNome,
      quantidade: totalItens,
      valor: order.total_amount ?? 0,
      status: order.order_status,
      pedidoEm: new Date(order.create_time * 1000),
    };
    if (existing) {
      await this.prisma.marketplaceOrder.update({
        where: { id: existing.id },
        data: {
          status: data.status,
          valor: data.valor,
          quantidade: data.quantidade,
          ...fin,
          situacao: situacaoShopee(order.order_status),
        },
      });
    } else {
      await this.prisma.marketplaceOrder.create({
        data: { ...data, ...fin, situacao: situacaoShopee(order.order_status) },
      });
    }
  }

  /**
   * Itens, taxas, frete da loja, líquido e custo (24/10). O extrato (escrow) é
   * uma chamada por pedido — só pra quem já foi pago/enviado e ainda não tem
   * líquido. Melhor esforço: nunca impede gravar o pedido.
   */
  private async financeiro(empresaId: string, order: ShopeeOrder, liquidoSalvo: number | null) {
    try {
      const pagoOuEnviado = [
        'READY_TO_SHIP',
        'PROCESSED',
        'SHIPPED',
        'TO_CONFIRM_RECEIVE',
        'COMPLETED',
      ].includes(order.order_status);
      let escrow: Parameters<typeof financeiroShopee>[1] = null;
      if (pagoOuEnviado && liquidoSalvo === null) {
        const r = await this.shopee
          .getShop<{
            response?: { order_income?: Parameters<typeof financeiroShopee>[1] };
          }>(empresaId, '/api/v2/payment/get_escrow_detail', { order_sn: order.order_sn })
          .catch(() => null);
        escrow = r?.response?.order_income ?? null;
      }
      const f = financeiroShopee(order, escrow);
      const c = await custoDosItens(this.prisma, empresaId, 'SHOPEE', f.itens);
      return {
        itens: c.itens as unknown as object,
        ...(f.liquido !== null ? { taxas: f.taxas, frete: f.frete, liquido: f.liquido } : {}),
        custo: c.custo,
        custoCompleto: c.completo,
        financeiroEm: new Date(),
      };
    } catch (err) {
      this.logger.warn(
        `[pedido Shopee ${order.order_sn}] financeiro não calculado: ${String(err)}`,
      );
      return {};
    }
  }
}
