import { Injectable, Logger } from '@nestjs/common';
import type {
  MarketplaceIncidentStatus,
  MarketplaceIncidentTipo,
} from '@prisma/client';
import { IncidentsService } from '@modules/incidents/incidents.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { ShopeeClientService } from './shopee-client.service';
import type { ShopeeReturn, ShopeeReturnListResponse } from './shopee.types';

/**
 * Returns/Refunds da Shopee — também cobre disputes (quando seller escala).
 *
 * Endpoints v2:
 *  - GET /api/v2/returns/get_return_list?page_no=&page_size=&...
 *  - GET /api/v2/returns/get_return_detail?return_sn=...
 *  - POST /api/v2/returns/dispute  body: { return_sn, dispute_reason, ... }
 *  - POST /api/v2/returns/accept_offer  body: { return_sn }
 *
 * Cada return vira:
 *  - `MarketplaceIncident` com tipo DEVOLUCAO (ou MEDIACAO/DISPUTA quando escala)
 *  - `Conversation` (categoria=DEVOLUCAO) com peerId=`return:<return_sn>`
 */
@Injectable()
export class ShopeeReturnsService {
  private readonly logger = new Logger(ShopeeReturnsService.name);

  constructor(
    private readonly shopee: ShopeeClientService,
    private readonly inbox: InboxService,
    private readonly incidents: IncidentsService,
  ) {}

  async obter(empresaId: string, returnSn: string): Promise<ShopeeReturn> {
    const r = await this.shopee.getShop<{ response: ShopeeReturn }>(
      empresaId,
      '/api/v2/returns/get_return_detail',
      { return_sn: returnSn },
    );
    return r.response;
  }

  async listar(empresaId: string, pageSize = 40): Promise<ShopeeReturn[]> {
    const r = await this.shopee.getShop<ShopeeReturnListResponse>(
      empresaId,
      '/api/v2/returns/get_return_list',
      { page_no: 1, page_size: pageSize },
    );
    return r.response?.return ?? [];
  }

  async processarReturn(empresaId: string, ret: ShopeeReturn): Promise<void> {
    const tipo = this.mapTipo(ret);
    const status = this.mapStatus(ret);
    const categoria = tipo === 'DISPUTA' || tipo === 'MEDIACAO' ? tipo : 'DEVOLUCAO';
    const peerId = `return:${ret.return_sn}`;
    const resumo = this.resumo(ret);

    const eventoEntrante = await this.inbox.processarMensagemEntrante({
      empresaId,
      canal: 'MARKETPLACE_SHOPEE',
      peerId,
      peerNome: ret.user?.username
        ? `Comprador Shopee ${ret.user.username}`
        : `Comprador Shopee (return ${ret.return_sn})`,
      tipo: 'SYSTEM',
      conteudo: resumo,
      externalId: `return:${ret.return_sn}:event:${ret.update_time}`,
      data: new Date(ret.update_time * 1000),
      meta: {
        shopee_return_sn: ret.return_sn,
        shopee_order_sn: ret.order_sn,
        shopee_status: ret.status,
        shopee_reason: ret.reason,
        categoria,
      },
    });

    await this.incidents.registrarIncidente({
      empresaId,
      canal: 'MARKETPLACE_SHOPEE',
      externalId: ret.return_sn,
      tipo,
      status,
      motivo: ret.text_reason ?? ret.reason ?? undefined,
      motivoCodigo: ret.reason ?? undefined,
      pedidoExternoId: ret.order_sn,
      valor: ret.refund_amount ?? undefined,
      valorReembolso: ret.refund_amount ?? undefined,
      prazoResposta: ret.due_date ? new Date(ret.due_date * 1000) : undefined,
      resumo,
      conversationId: eventoEntrante.conversationId,
      metadata: { shopee_return: ret },
    });
  }

  /** Vendedor abre disputa (escala uma return). */
  async abrirDisputa(
    empresaId: string,
    returnSn: string,
    motivo: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.shopee.postShop(empresaId, '/api/v2/returns/dispute', {
      return_sn: returnSn,
      dispute_reason: motivo,
      ...extra,
    });
  }

  /** Aceita a oferta atual da return (resolve sem escalar). */
  async aceitarOferta(empresaId: string, returnSn: string): Promise<void> {
    await this.shopee.postShop(empresaId, '/api/v2/returns/accept_offer', {
      return_sn: returnSn,
    });
  }

  // ─── Mapping ──────────────────────────────────────────────────────────

  private mapTipo(ret: ShopeeReturn): MarketplaceIncidentTipo {
    if (ret.status === 'SELLER_DISPUTE') return 'DISPUTA';
    if (ret.status === 'JUDGING') return 'MEDIACAO';
    return 'DEVOLUCAO';
  }

  private mapStatus(ret: ShopeeReturn): MarketplaceIncidentStatus {
    switch (ret.status) {
      case 'REQUESTED':
        return 'AGUARDANDO_VENDEDOR';
      case 'ACCEPTED':
      case 'PROCESSING':
        return 'AGUARDANDO_COMPRADOR';
      case 'JUDGING':
      case 'SELLER_DISPUTE':
        return 'EM_MEDIACAO';
      case 'REFUND_PAID':
      case 'CLOSED':
        return 'RESOLVIDO';
      case 'CANCELLED':
        return 'CANCELADO';
      default:
        return 'ABERTO';
    }
  }

  private resumo(ret: ShopeeReturn): string {
    const partes = [
      `Devolução ${ret.return_sn}`,
      `pedido=${ret.order_sn}`,
      `status=${ret.status}`,
      ret.refund_amount !== undefined ? `valor=${ret.refund_amount}` : null,
      ret.text_reason,
    ].filter(Boolean);
    return partes.join(' · ').slice(0, 280);
  }
}
