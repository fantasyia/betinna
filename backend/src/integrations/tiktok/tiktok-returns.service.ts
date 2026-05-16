import { Injectable, Logger } from '@nestjs/common';
import type {
  MarketplaceIncidentStatus,
  MarketplaceIncidentTipo,
} from '@prisma/client';
import { EnvService } from '@config/env.service';
import { IncidentsService } from '@modules/incidents/incidents.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { TikTokClientService } from './tiktok-client.service';
import type {
  TikTokReturn,
  TikTokReturnListResponse,
  TikTokReturnStatus,
} from './tiktok.types';

/**
 * Returns / Refunds da TikTok Shop.
 *
 * Endpoints v202309:
 *  - POST /return_refund/202309/returns/search    → listar
 *  - POST /return_refund/202309/returns/get       → detalhe (ids[])
 *  - POST /return_refund/202309/returns/{return_id}/seller_proposal
 *  - POST /return_refund/202309/returns/{return_id}/seller_reject
 *  - POST /return_refund/202309/returns/{return_id}/seller_evidence
 *
 * Cada return vira:
 *  - `MarketplaceIncident` com status mapeado (IN_ARBITRATION→EM_MEDIACAO,
 *    REFUND_SUCCESS→RESOLVIDO, RETURN_OR_REFUND_REQUEST_PENDING→AGUARDANDO_VENDEDOR
 *    etc.)
 *  - `Conversation` (categoria DEVOLUCAO ou MEDIACAO) com peerId=`return:<id>`
 *
 * TikTok Shop não suporta texto livre nas returns — só ações estruturadas.
 */
@Injectable()
export class TikTokReturnsService {
  private readonly logger = new Logger(TikTokReturnsService.name);

  constructor(
    private readonly tiktok: TikTokClientService,
    private readonly env: EnvService,
    private readonly inbox: InboxService,
    private readonly incidents: IncidentsService,
  ) {}

  private get apiVersion(): string {
    return this.env.get('TIKTOK_API_VERSION');
  }

  async listar(empresaId: string, pageSize = 50): Promise<TikTokReturn[]> {
    const r = await this.tiktok.post<TikTokReturnListResponse>(
      empresaId,
      `/return_refund/${this.apiVersion}/returns/search`,
      {},
      { page_size: pageSize },
    );
    return r.data?.return_records ?? [];
  }

  async obter(empresaId: string, returnId: string): Promise<TikTokReturn | null> {
    const r = await this.tiktok.post<{
      data: { return_records: TikTokReturn[] };
    }>(empresaId, `/return_refund/${this.apiVersion}/returns/get`, {
      ids: [returnId],
    });
    return r.data?.return_records?.[0] ?? null;
  }

  async aceitar(empresaId: string, returnId: string): Promise<void> {
    await this.tiktok.post(
      empresaId,
      `/return_refund/${this.apiVersion}/returns/${encodeURIComponent(returnId)}/seller_proposal`,
      { decision: 'AGREE' },
    );
  }

  async rejeitar(empresaId: string, returnId: string, motivo: string): Promise<void> {
    await this.tiktok.post(
      empresaId,
      `/return_refund/${this.apiVersion}/returns/${encodeURIComponent(returnId)}/seller_reject`,
      { reject_reason: motivo },
    );
  }

  async anexarEvidencia(
    empresaId: string,
    returnId: string,
    imagens: string[],
  ): Promise<void> {
    await this.tiktok.post(
      empresaId,
      `/return_refund/${this.apiVersion}/returns/${encodeURIComponent(returnId)}/seller_evidence`,
      { images: imagens },
    );
  }

  async processarReturn(empresaId: string, ret: TikTokReturn): Promise<void> {
    const tipo = this.mapTipo(ret);
    const status = this.mapStatus(ret.status);
    const categoria = tipo === 'MEDIACAO' || tipo === 'DISPUTA' ? tipo : 'DEVOLUCAO';
    const peerId = `return:${ret.return_id}`;
    const resumo = this.resumo(ret);

    const eventoEntrante = await this.inbox.processarMensagemEntrante({
      empresaId,
      canal: 'MARKETPLACE_TIKTOK',
      peerId,
      peerNome: `Comprador TikTok (return ${ret.return_id})`,
      tipo: 'SYSTEM',
      conteudo: resumo,
      externalId: `return:${ret.return_id}:event:${ret.update_time}`,
      data: new Date(ret.update_time * 1000),
      meta: {
        tiktok_return_id: ret.return_id,
        tiktok_order_id: ret.order_id,
        tiktok_status: ret.status,
        tiktok_return_type: ret.return_type,
        categoria,
      },
    });

    await this.incidents.registrarIncidente({
      empresaId,
      canal: 'MARKETPLACE_TIKTOK',
      externalId: ret.return_id,
      tipo,
      status,
      motivo: ret.return_reason_text ?? ret.return_reason ?? undefined,
      motivoCodigo: ret.return_reason ?? undefined,
      pedidoExternoId: ret.order_id,
      valor: ret.refund_amount?.amount ? parseFloat(ret.refund_amount.amount) : undefined,
      valorReembolso: ret.refund_amount?.amount ? parseFloat(ret.refund_amount.amount) : undefined,
      prazoResposta: ret.seller_proposal_deadline
        ? new Date(ret.seller_proposal_deadline * 1000)
        : ret.arbitration_deadline
          ? new Date(ret.arbitration_deadline * 1000)
          : undefined,
      resumo,
      conversationId: eventoEntrante.conversationId,
      metadata: { tiktok_return: ret },
    });
  }

  // ─── Mapping ─────────────────────────────────────────────────────────

  private mapTipo(ret: TikTokReturn): MarketplaceIncidentTipo {
    if (ret.status === 'IN_ARBITRATION') return 'MEDIACAO';
    if (ret.return_type === 'REFUND_ONLY') return 'DEVOLUCAO';
    return 'DEVOLUCAO';
  }

  private mapStatus(s: TikTokReturnStatus): MarketplaceIncidentStatus {
    switch (s) {
      case 'RETURN_OR_REFUND_REQUEST_PENDING':
        return 'AGUARDANDO_VENDEDOR';
      case 'AWAITING_BUYER_SHIP':
      case 'AWAITING_SELLER_CONFIRM_RECEIVE':
        return 'AGUARDANDO_COMPRADOR';
      case 'IN_ARBITRATION':
        return 'EM_MEDIACAO';
      case 'REFUND_SUCCESS':
      case 'COMPLETED':
        return 'RESOLVIDO';
      case 'REFUND_FAIL':
      case 'CLOSED':
      case 'REJECTED':
        return 'RESOLVIDO';
      case 'BUYER_CANCEL_REQUEST':
        return 'CANCELADO';
      default:
        return 'ABERTO';
    }
  }

  private resumo(ret: TikTokReturn): string {
    const partes = [
      `Devolução TikTok ${ret.return_id}`,
      `pedido=${ret.order_id}`,
      `status=${ret.status}`,
      ret.refund_amount?.amount ? `valor=${ret.refund_amount.amount}` : null,
      ret.return_reason_text,
    ].filter(Boolean);
    return partes.join(' · ').slice(0, 280);
  }
}
