import { Injectable, Logger } from '@nestjs/common';
import { InboxService } from '@modules/inbox/inbox.service';
import { MLClientService } from './ml-client.service';
import type { MLMessage, MLMessagesResponse } from './ml.types';

/**
 * Chat pós-venda do Mercado Livre — vinculado a um "pack" (conjunto de pedidos
 * do mesmo comprador no mesmo carrinho) ou a um order_id quando solo.
 *
 * Endpoint base:
 *   GET  /messages/packs/{pack_id}/sellers/{seller_id}
 *   POST /messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale
 *
 * Peer ID na Inbox: `pack:<pack_id>` — todas mensagens do pack vivem na mesma
 * Conversation (categoria=POS_VENDA).
 */
@Injectable()
export class MLMessagesService {
  private readonly logger = new Logger(MLMessagesService.name);

  constructor(
    private readonly ml: MLClientService,
    private readonly inbox: InboxService,
  ) {}

  async listarMensagens(
    empresaId: string,
    packId: string | number,
    sellerId: string | number,
  ): Promise<MLMessage[]> {
    const r = await this.ml.get<MLMessagesResponse>(
      empresaId,
      `/messages/packs/${packId}/sellers/${sellerId}?mark_as_read=false`,
    );
    return r.messages ?? [];
  }

  /**
   * Processa mensagens entrantes do pack. Cada Message INBOUND nossa que
   * não estava na Inbox é criada via `InboxService.processarMensagemEntrante`.
   * Idempotência via externalId = ML message id.
   */
  async processarPack(
    empresaId: string,
    packId: string | number,
    sellerId: string | number,
  ): Promise<{ processadas: number }> {
    const sellerIdNum = Number(sellerId);
    const messages = await this.listarMensagens(empresaId, packId, sellerId);
    let processadas = 0;
    for (const m of messages) {
      const fromMe = m.from.user_id === sellerIdNum;
      if (fromMe) continue; // não processamos echoes das nossas próprias mensagens
      await this.inbox.processarMensagemEntrante({
        empresaId,
        canal: 'MARKETPLACE_ML',
        peerId: `pack:${packId}`,
        peerNome: `Comprador ML #${m.from.user_id}`,
        tipo: m.message_attachments?.length ? 'DOCUMENT' : 'TEXT',
        conteudo: m.text?.plain ?? '[mensagem]',
        externalId: m.id,
        data: m.message_date?.received
          ? new Date(m.message_date.received)
          : m.message_date?.created
            ? new Date(m.message_date.created)
            : undefined,
        meta: {
          ml_message_id: m.id,
          ml_pack_id: packId,
          ml_seller_id: sellerIdNum,
          ml_buyer_id: m.from.user_id,
          ml_status: m.status,
          categoria: 'POS_VENDA',
        },
      });
      processadas++;
    }
    return { processadas };
  }

  /**
   * Envia mensagem no chat pós-venda do pack.
   * `from` = seller (sempre o user_id da nossa conta).
   * `to` = buyer (precisa ser passado pelo caller — vem da Conversation).
   */
  async enviarMensagem(
    empresaId: string,
    packId: string | number,
    sellerId: string | number,
    buyerId: string | number,
    texto: string,
  ): Promise<{ externalId?: string }> {
    const r = await this.ml.post<{ id?: string }>(
      empresaId,
      `/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`,
      {
        from: { user_id: Number(sellerId) },
        to: { user_id: Number(buyerId) },
        text: { plain: texto },
      },
    );
    return { externalId: r.id };
  }
}
