import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { MessageChannel } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { CanalAdapterRegistry } from '@modules/inbox/canal-adapter.registry';
import type { CanalAdapter } from '@modules/inbox/inbox.types';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { MLClaimsService } from './ml-claims.service';
import { MLClientService } from './ml-client.service';
import { MLMessagesService } from './ml-messages.service';
import { MLQuestionsService } from './ml-questions.service';

/**
 * Adapter de Mercado Livre pra Inbox unificada.
 *
 * Rotear `enviarTexto` é a parte sensível: o ML não tem "um chat" único —
 * dependendo da categoria da Conversation, o destino é:
 *   - PRE_VENDA   → MLQuestionsService.responder(question_id)
 *   - POS_VENDA   → MLMessagesService.enviarMensagem(pack_id, seller_id, buyer_id)
 *   - RECLAMACAO  → MLClaimsService.enviarMensagem(claim_id)
 *   - MEDIACAO    → MLClaimsService.enviarMensagem(claim_id)
 *   - DEVOLUCAO   → MLClaimsService.enviarMensagem(claim_id)
 *   - DISPUTA     → MLClaimsService.enviarMensagem(claim_id)
 *
 * O `peerId` da Conversation carrega a info (q:<id>, pack:<id>, claim:<id>),
 * mas pra `pack:` precisamos do buyer_id que está em `Conversation.metadata`
 * (preenchido por `MLMessagesService.processarPack`).
 */
@Injectable()
export class MLService implements CanalAdapter, OnModuleInit {
  readonly canal: MessageChannel = 'MARKETPLACE_ML';
  private readonly logger = new Logger(MLService.name);

  constructor(
    private readonly registry: CanalAdapterRegistry,
    private readonly prisma: PrismaService,
    private readonly client: MLClientService,
    private readonly questions: MLQuestionsService,
    private readonly messages: MLMessagesService,
    private readonly claims: MLClaimsService,
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
    // Recupera a Conversation pra extrair categoria + metadata.
    // ML é empresa-scoped → proprietarioId sempre null.
    const conv = await this.prisma.conversation.findFirst({
      where: { empresaId, canal: this.canal, peerId, proprietarioId: null },
      select: { categoria: true, metadata: true },
    });
    const meta = (conv?.metadata as Record<string, unknown> | null) ?? {};

    if (peerId.startsWith('q:')) {
      const questionId = peerId.slice(2);
      return this.questions.responder(empresaId, questionId, texto);
    }

    if (peerId.startsWith('pack:')) {
      const packId = peerId.slice('pack:'.length);
      const sellerId = String(meta['ml_seller_id'] ?? '');
      const buyerId = String(meta['ml_buyer_id'] ?? '');
      if (!sellerId || !buyerId) {
        // Fallback: tenta resolver via credenciais (seller) — buyer_id é obrigatório.
        const creds = await this.client.getCredenciais(empresaId);
        if (!buyerId) {
          throw new BusinessRuleException(
            `Não foi possível determinar buyer_id pra responder pack ${packId} — metadata da conversa incompleto`,
          );
        }
        return this.messages.enviarMensagem(empresaId, packId, creds.userId, buyerId, texto);
      }
      return this.messages.enviarMensagem(empresaId, packId, sellerId, buyerId, texto);
    }

    if (peerId.startsWith('claim:')) {
      const claimId = peerId.slice('claim:'.length);
      return this.claims.enviarMensagem(empresaId, claimId, texto);
    }

    throw new BusinessRuleException(
      `Conversation ML com peerId="${peerId}" não tem formato reconhecido (esperado q:|pack:|claim:)`,
    );
  }
}
