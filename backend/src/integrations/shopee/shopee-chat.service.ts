import { Injectable, Logger } from '@nestjs/common';
import { InboxService } from '@modules/inbox/inbox.service';
import { ShopeeClientService } from './shopee-client.service';
import type { ShopeeChatGetMessageResponse, ShopeeChatMessage } from './shopee.types';

/**
 * Chat Shopee (mensagens diretas comprador ↔ vendedor).
 *
 * Endpoints v2:
 *  - GET  /api/v2/sellerchat/get_message?conversation_id=...&offset=...&page_size=...
 *  - POST /api/v2/sellerchat/send_message  body: { to_id, message_type, content }
 *
 * Peer ID na Inbox: `conv:<conversation_id>` — uma Conversation por thread.
 */

/** Figurinha da Shopee: pacote + id, como vem no `content` de uma figurinha recebida. */
export interface FigurinhaShopee {
  stickerPackageId: string;
  stickerId: string;
}

/**
 * Corpo do send_message de figurinha (14/11). Mesmo formato que a Shopee devolve
 * no get_message: `content: { sticker_id, sticker_package_id }`, ex. pacote
 * "br_shoppito", id "0002" — strings, com os zeros à esquerda.
 */
export function corpoFigurinha(toBuyerId: string | number, f: FigurinhaShopee) {
  return {
    to_id: Number(toBuyerId),
    message_type: 'sticker',
    content: { sticker_id: f.stickerId, sticker_package_id: f.stickerPackageId },
  };
}

@Injectable()
export class ShopeeChatService {
  private readonly logger = new Logger(ShopeeChatService.name);

  constructor(
    private readonly shopee: ShopeeClientService,
    private readonly inbox: InboxService,
  ) {}

  async listarMensagens(
    empresaId: string,
    conversationId: string,
    pageSize = 50,
  ): Promise<ShopeeChatMessage[]> {
    const r = await this.shopee.getShop<ShopeeChatGetMessageResponse>(
      empresaId,
      '/api/v2/sellerchat/get_message',
      { conversation_id: conversationId, page_size: pageSize },
    );
    return r.response?.messages ?? [];
  }

  async processarConversation(
    empresaId: string,
    conversationId: string,
  ): Promise<{ processadas: number }> {
    const creds = await this.shopee.getCredenciais(empresaId);
    const shopIdNum = Number(creds.shopId);
    const msgs = await this.listarMensagens(empresaId, conversationId);
    // A Shopee devolve as últimas 50 da conversa a cada aviso; quase todas já estão
    // gravadas. Uma consulta só diz quais pular — antes era uma por mensagem
    // (Sentry BETINNA-BACKEND-15).
    const jaGravadas = await this.inbox.externalIdsGravados(
      empresaId,
      'MARKETPLACE_SHOPEE',
      msgs.map((m) => String(m.message_id)),
    );
    let processadas = 0;
    for (const m of msgs) {
      if (jaGravadas.has(String(m.message_id))) continue;
      // Nossas mensagens (from_shop_id = nosso shop) entram como OUTBOUND (25/10): a
      // conversa no app mostra os dois lados, inclusive o que foi respondido pelo
      // painel da Shopee — e a IA vê quem falou por último.
      const daLoja = m.from_shop_id === shopIdNum;
      const { conteudo, tipo, mediaUrl } = this.extrair(m);
      if (!conteudo && tipo === 'TEXT') continue;
      await this.inbox.processarMensagemEntrante({
        empresaId,
        canal: 'MARKETPLACE_SHOPEE',
        peerId: `conv:${conversationId}`,
        peerNome: daLoja ? undefined : `Comprador Shopee #${m.from_id}`,
        direction: daLoja ? 'OUTBOUND' : 'INBOUND',
        tipo,
        conteudo,
        externalId: m.message_id,
        data: new Date(m.created_timestamp * 1000),
        mediaUrl,
        meta: {
          shopee_conv_id: conversationId,
          shopee_message_id: m.message_id,
          // Comprador = quem NÃO é a loja (o send_message precisa dele em to_id).
          shopee_from_id: daLoja ? m.to_id : m.from_id,
          shopee_to_id: m.to_id,
          shopee_message_type: m.message_type,
          shopee_source: m.source,
          categoria: 'POS_VENDA',
        },
      });
      processadas++;
    }
    return { processadas };
  }

  async enviarMensagem(
    empresaId: string,
    conversationId: string,
    toBuyerId: string | number,
    texto: string,
  ): Promise<{ externalId?: string }> {
    const r = await this.shopee.postShop<{
      response?: { message_id?: string };
    }>(empresaId, '/api/v2/sellerchat/send_message', {
      to_id: Number(toBuyerId),
      message_type: 'text',
      content: { text: texto },
      // SEM conversation_id: a Shopee recusava (HTTP 491 param_error, 25/10) — o campo é
      // de outro tipo de conversa e ia como texto. to_id + conteúdo bastam.
    });
    void conversationId;
    return { externalId: r.response?.message_id };
  }

  /** Manda uma figurinha (sem conversation_id, pelo mesmo motivo do texto). */
  async enviarFigurinha(
    empresaId: string,
    toBuyerId: string | number,
    figurinha: FigurinhaShopee,
  ): Promise<{ externalId?: string }> {
    const r = await this.shopee.postShop<{
      response?: { message_id?: string };
    }>(empresaId, '/api/v2/sellerchat/send_message', corpoFigurinha(toBuyerId, figurinha));
    return { externalId: r.response?.message_id };
  }

  private extrair(m: ShopeeChatMessage): {
    conteudo: string;
    tipo: 'TEXT' | 'IMAGE' | 'STICKER' | 'CONTACT' | 'DOCUMENT';
    mediaUrl?: string;
  } {
    switch (m.message_type) {
      case 'text':
        return { conteudo: m.content?.text ?? '', tipo: 'TEXT' };
      case 'image':
        return { conteudo: '[imagem]', tipo: 'IMAGE', mediaUrl: m.content?.url };
      case 'sticker':
        return { conteudo: '[sticker]', tipo: 'STICKER' };
      case 'item':
        return {
          conteudo: `[produto: ${m.content?.item_id ?? '?'}]`,
          tipo: 'CONTACT',
        };
      case 'order':
        return {
          conteudo: `[pedido: ${m.content?.order_sn ?? '?'}]`,
          tipo: 'CONTACT',
        };
      default:
        return { conteudo: `[${m.message_type}]`, tipo: 'TEXT' };
    }
  }
}
