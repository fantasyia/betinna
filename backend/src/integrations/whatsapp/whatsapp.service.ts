import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { MessageChannel } from '@prisma/client';
import { CanalAdapterRegistry } from '@modules/inbox/canal-adapter.registry';
import type { CanalAdapter, CanalAdapterContexto } from '@modules/inbox/inbox.types';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { WhatsAppSessionService } from './whatsapp-session.service';

/**
 * Adapter de WhatsApp para a Inbox unificada.
 *
 * Roteamento de sessão (peça crítica do dual-owner):
 *  - `ctx.proprietarioId` preenchido → sessão USUARIO desse rep (WhatsApp pessoal)
 *  - `ctx.proprietarioId` nulo → sessão EMPRESA (WhatsApp central)
 *
 * O `enviarTexto` precisa do contexto pra escolher a sessão Baileys correta.
 * Sem isso, mensagens iriam pro número errado quando há múltiplas sessões.
 */
@Injectable()
export class WhatsAppService implements CanalAdapter, OnModuleInit {
  readonly canal: MessageChannel = 'WHATSAPP';

  constructor(
    private readonly sessions: WhatsAppSessionService,
    private readonly registry: CanalAdapterRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.registrar(this);
  }

  async enviarTexto(
    empresaId: string,
    peerId: string,
    texto: string,
    ctx?: CanalAdapterContexto,
  ): Promise<{ externalId?: string }> {
    const owner = ctx?.proprietarioId
      ? { type: 'USUARIO' as const, id: ctx.proprietarioId }
      : { type: 'EMPRESA' as const, id: empresaId };
    if (!this.sessions.estaConectado(owner)) {
      throw new BusinessRuleException(
        owner.type === 'USUARIO'
          ? 'Seu WhatsApp pessoal não está conectado. Conecte em Integrações.'
          : 'WhatsApp da empresa não está conectado.',
      );
    }
    return this.sessions.enviarTexto(owner, peerId, texto);
  }

  async estaDisponivel(empresaId: string, proprietarioId?: string | null): Promise<boolean> {
    const owner = proprietarioId
      ? { type: 'USUARIO' as const, id: proprietarioId }
      : { type: 'EMPRESA' as const, id: empresaId };
    return this.sessions.estaConectado(owner);
  }

  /**
   * Envia mídia (imagem/vídeo/áudio/documento) através do WhatsApp.
   * Encaminha pra WhatsAppSessionService — esta classe é só fachada.
   */
  async enviarMidia(
    empresaId: string,
    peerId: string,
    params: Parameters<typeof this.sessions.enviarMidia>[2],
    ctx?: CanalAdapterContexto,
  ): Promise<{ externalId?: string }> {
    const owner = ctx?.proprietarioId
      ? { type: 'USUARIO' as const, id: ctx.proprietarioId }
      : { type: 'EMPRESA' as const, id: empresaId };
    if (!this.sessions.estaConectado(owner)) {
      throw new BusinessRuleException(
        owner.type === 'USUARIO'
          ? 'Seu WhatsApp pessoal não está conectado.'
          : 'WhatsApp da empresa não está conectado.',
      );
    }
    return this.sessions.enviarMidia(owner, peerId, params);
  }
}
