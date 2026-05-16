import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { MessageChannel } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { CanalAdapterRegistry } from '@modules/inbox/canal-adapter.registry';
import type { CanalAdapter } from '@modules/inbox/inbox.types';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ShopeeChatService } from './shopee-chat.service';
import { ShopeeClientService } from './shopee-client.service';

/**
 * Adapter Shopee pra Inbox.
 *
 * Conversation peerId:
 *   - `conv:<conversation_id>` → chat normal → ShopeeChatService.enviarMensagem
 *   - `return:<return_sn>`     → return/dispute (sem chat direto na API de returns
 *     da Shopee — não suporta envio livre. Vendedor responde via ações específicas
 *     como abrirDisputa/aceitarOferta. Por isso bloqueamos envio de texto livre.)
 */
@Injectable()
export class ShopeeService implements CanalAdapter, OnModuleInit {
  readonly canal: MessageChannel = 'MARKETPLACE_SHOPEE';
  private readonly logger = new Logger(ShopeeService.name);

  constructor(
    private readonly registry: CanalAdapterRegistry,
    private readonly prisma: PrismaService,
    private readonly client: ShopeeClientService,
    private readonly chat: ShopeeChatService,
  ) {}

  onModuleInit(): void {
    this.registry.registrar(this);
  }

  async estaDisponivel(empresaId: string): Promise<boolean> {
    try {
      await this.client.getCredenciais(empresaId);
      return true;
    } catch {
      return false;
    }
  }

  async enviarTexto(
    empresaId: string,
    peerId: string,
    texto: string,
  ): Promise<{ externalId?: string }> {
    if (peerId.startsWith('conv:')) {
      const conversationId = peerId.slice('conv:'.length);
      const conv = await this.prisma.conversation.findFirst({
        where: { empresaId, canal: this.canal, peerId, proprietarioId: null },
        select: { metadata: true },
      });
      const meta = (conv?.metadata as Record<string, unknown> | null) ?? {};
      const toBuyerId = String(meta['shopee_from_id'] ?? '');
      if (!toBuyerId) {
        throw new BusinessRuleException(
          `Conversation Shopee ${conversationId} sem buyer_id em metadata — não consegue responder`,
        );
      }
      return this.chat.enviarMensagem(empresaId, conversationId, toBuyerId, texto);
    }

    if (peerId.startsWith('return:')) {
      throw new BusinessRuleException(
        'Shopee não suporta resposta livre em returns/disputes. Use abrirDisputa/aceitarOferta nos endpoints específicos.',
      );
    }

    throw new BusinessRuleException(
      `Conversation Shopee com peerId="${peerId}" não tem formato reconhecido (esperado conv:|return:)`,
    );
  }
}
