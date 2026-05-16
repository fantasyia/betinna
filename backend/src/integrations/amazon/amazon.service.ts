import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { MessageChannel } from '@prisma/client';
import { CanalAdapterRegistry } from '@modules/inbox/canal-adapter.registry';
import type { CanalAdapter } from '@modules/inbox/inbox.types';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { AmazonClientService } from './amazon-client.service';
import { AmazonMessagingService } from './amazon-messaging.service';

/**
 * Adapter Amazon pra Inbox.
 *
 * Conversation peerId: `order:<amazonOrderId>`
 *
 * Amazon não tem chat livre — `enviarTexto` é roteado pra Permitted Action
 * apropriada (vide AmazonMessagingService.enviarTextoLivre).
 *
 * Texto curto demais (< 5 chars) é rejeitado: Amazon rejeita mensagens
 * triviais como "ok" / "obrigado" sem contexto — economizamos uma roundtrip
 * que voltaria 4xx.
 */
@Injectable()
export class AmazonService implements CanalAdapter, OnModuleInit {
  readonly canal: MessageChannel = 'MARKETPLACE_AMAZON';
  private readonly logger = new Logger(AmazonService.name);

  constructor(
    private readonly registry: CanalAdapterRegistry,
    private readonly client: AmazonClientService,
    private readonly messaging: AmazonMessagingService,
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
    if (!peerId.startsWith('order:')) {
      throw new BusinessRuleException(
        `Conversation Amazon com peerId="${peerId}" não tem formato reconhecido (esperado order:)`,
      );
    }
    const amazonOrderId = peerId.slice('order:'.length);
    if (texto.trim().length < 5) {
      throw new BusinessRuleException(
        'Amazon Messaging rejeita textos muito curtos (<5 chars) — adicione contexto',
      );
    }
    const r = await this.messaging.enviarTextoLivre(empresaId, amazonOrderId, texto);
    // Amazon não retorna messageId. Usamos action+orderId como referência local.
    return { externalId: `${r.acaoUsada}:${amazonOrderId}:${Date.now()}` };
  }
}
