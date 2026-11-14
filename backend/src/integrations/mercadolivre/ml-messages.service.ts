import { Injectable, Logger } from '@nestjs/common';
import { InboxService } from '@modules/inbox/inbox.service';
import { MLClientService } from './ml-client.service';
import type { MLMessage, MLMessagesResponse, MLOrder, MLUnreadResponse } from './ml.types';

/** Pack da mensagem: `packs` primeiro; venda sem pack usa o id do pedido (`orders`). */
export function packDosRecursos(
  recursos: Array<{ id?: string | number; name?: string }> | undefined,
): string | null {
  const lista = recursos ?? [];
  const pack =
    lista.find((r) => r.name === 'packs' && r.id) ?? lista.find((r) => r.name === 'orders' && r.id);
  return pack?.id ? String(pack.id) : null;
}

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
    // `tag=post_sale` é obrigatório na API de mensagens; sem `limit` o ML devolve
    // só 10 — pack com conversa longa perdia o fim. Pagina até o total (teto de
    // 5 páginas, ~250 mensagens, pra não travar o cron num pack anômalo).
    const todas: MLMessage[] = [];
    const limit = 50;
    for (let pagina = 0; pagina < 5; pagina++) {
      const offset = pagina * limit;
      const r = await this.ml.get<MLMessagesResponse>(
        empresaId,
        `/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale&mark_as_read=false&limit=${limit}&offset=${offset}`,
      );
      const lote = r?.messages ?? [];
      todas.push(...lote);
      const total = r?.paging?.total ?? 0;
      if (lote.length < limit || todas.length >= total) break;
    }
    return todas;
  }

  /**
   * Webhook do tópico `messages`: o `resource` é o ID DA MENSAGEM (hash, ex.
   * `0ce04d2ff5b7489d916c87d0ac7a4bc3`), não um caminho de pack. O código antigo
   * esperava `/packs/{p}/sellers/{s}` e procurava ID numérico — toda notificação
   * de mensagem caía em "resource sem ID" e nenhum pós-venda entrava (14/11).
   * Aceita os dois formatos: caminho de pack direto, ou ID da mensagem → lê a
   * mensagem e acha o pack em `message_resources`.
   */
  async processarNotificacao(
    empresaId: string,
    resource: string,
    sellerId: string | number,
  ): Promise<{ processadas: number; packId: string | null }> {
    const direto = resource.match(/\/packs\/(\d+)\/sellers\/(\d+)/);
    if (direto) {
      const r = await this.processarPack(empresaId, direto[1], direto[2]);
      return { ...r, packId: direto[1] };
    }
    const messageId = resource.split('/').filter(Boolean).pop() ?? '';
    if (!/^[A-Za-z0-9_-]+$/.test(messageId)) {
      this.logger.warn(`Notificação ML messages com resource não-reconhecido: ${resource}`);
      return { processadas: 0, packId: null };
    }
    const packId = await this.packDaMensagem(empresaId, messageId);
    if (!packId) {
      this.logger.warn(`Mensagem ML ${messageId} sem pack/pedido em message_resources — ignorada`);
      return { processadas: 0, packId: null };
    }
    const r = await this.processarPack(empresaId, packId, sellerId);
    return { ...r, packId };
  }

  /**
   * Pack (ou pedido, quando a venda não tem pack — o ML usa o order_id no lugar
   * do pack_id) a que a mensagem pertence.
   */
  async packDaMensagem(empresaId: string, messageId: string): Promise<string | null> {
    const r = await this.ml.get<MLMessagesResponse | MLMessage>(
      empresaId,
      `/messages/${messageId}?tag=post_sale`,
    );
    const msg: MLMessage | undefined =
      r && 'messages' in r && Array.isArray(r.messages) ? r.messages[0] : (r as MLMessage);
    return packDosRecursos(msg?.message_resources);
  }

  /**
   * Rede de segurança do cron (14/11): webhook perdido não pode perder mensagem.
   * Junta os packs com mensagem NÃO LIDA (`/messages/unread`) e os dos pedidos
   * movimentados nos últimos 2 dias, e reprocessa cada pack uma vez. Idempotente
   * pelo `externalId` (id da mensagem no ML) — reimportar não duplica.
   */
  async sincronizarRecentes(
    empresaId: string,
    sellerId: string | number,
    pedidosRecentes: Array<
      Pick<MLOrder, 'id' | 'pack_id' | 'date_created'> & {
        date_last_updated?: string;
      }
    >,
    agora: Date = new Date(),
  ): Promise<{ packs: number; mensagens: number; falhas: number }> {
    const packs = new Set<string>();

    try {
      const r = await this.ml.get<MLUnreadResponse>(
        empresaId,
        `/messages/unread?role=seller&tag=post_sale`,
      );
      for (const u of r?.results ?? []) {
        const m = String(u.resource ?? '').match(/\/packs\/(\d+)/);
        if (m) packs.add(m[1]);
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Mensagens não lidas ML empresa=${empresaId}: ${m}`);
    }

    const corte = agora.getTime() - 2 * 24 * 60 * 60 * 1000;
    for (const o of pedidosRecentes) {
      const quando = Date.parse(o.date_last_updated ?? o.date_created);
      if (!Number.isFinite(quando) || quando < corte) continue;
      packs.add(String(o.pack_id ?? o.id));
      if (packs.size >= 40) break;
    }

    let mensagens = 0;
    let falhas = 0;
    for (const packId of packs) {
      try {
        const r = await this.processarPack(empresaId, packId, sellerId);
        mensagens += r.processadas;
      } catch (err) {
        falhas++;
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Pack ML ${packId} empresa=${empresaId}: ${m}`);
      }
    }
    return { packs: packs.size, mensagens, falhas };
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
      // Nossas mensagens entram como OUTBOUND (25/10): o app mostra a conversa inteira
      // do pós-venda (inclusive o respondido pelo painel do ML); o envio pelo app
      // não duplica (eco adota o externalId).
      const fromMe = m.from.user_id === sellerIdNum;
      await this.inbox.processarMensagemEntrante({
        empresaId,
        canal: 'MARKETPLACE_ML',
        peerId: `pack:${packId}`,
        peerNome: fromMe ? undefined : `Comprador ML #${m.from.user_id}`,
        direction: fromMe ? 'OUTBOUND' : 'INBOUND',
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
          ml_buyer_id: fromMe ? m.to?.user_id : m.from.user_id,
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
