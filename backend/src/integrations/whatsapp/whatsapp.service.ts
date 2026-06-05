import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { MessageChannel } from '@prisma/client';
import { CanalAdapterRegistry } from '@modules/inbox/canal-adapter.registry';
import type { CanalAdapter, CanalAdapterContexto } from '@modules/inbox/inbox.types';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { EnvService } from '@config/env.service';
import { EvolutionService } from '@integrations/evolution/evolution.service';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppMediaService } from './whatsapp-media.service';

type Owner = { type: 'EMPRESA' | 'USUARIO'; id: string };

/**
 * Adapter de WhatsApp para a Inbox unificada.
 *
 * Roteia entre DOIS providers conforme `WHATSAPP_PROVIDER`:
 *  - 'baileys'   → socket embutido (WhatsAppSessionService) — atual
 *  - 'evolution' → Evolution API como serviço separado (EvolutionService)
 *
 * Roteamento de dono (dual-owner): `ctx.proprietarioId` → USUARIO (rep), senão
 * EMPRESA (central). Sem isso, mensagens iriam pro número errado.
 */
@Injectable()
export class WhatsAppService implements CanalAdapter, OnModuleInit {
  readonly canal: MessageChannel = 'WHATSAPP';

  constructor(
    private readonly sessions: WhatsAppSessionService,
    private readonly registry: CanalAdapterRegistry,
    private readonly media: WhatsAppMediaService,
    private readonly env: EnvService,
    private readonly evolution: EvolutionService,
  ) {}

  private get viaEvolution(): boolean {
    return this.env.get('WHATSAPP_PROVIDER') === 'evolution';
  }

  private ownerDe(empresaId: string, ctx?: CanalAdapterContexto): Owner {
    return ctx?.proprietarioId
      ? { type: 'USUARIO', id: ctx.proprietarioId }
      : { type: 'EMPRESA', id: empresaId };
  }

  /** Baixa os bytes de uma mídia armazenada (pra IA transcrever/ver). */
  async baixarMidia(storagePath: string): Promise<Buffer | null> {
    return this.media.baixar(storagePath);
  }

  onModuleInit(): void {
    this.registry.registrar(this);
  }

  async enviarTexto(
    empresaId: string,
    peerId: string,
    texto: string,
    ctx?: CanalAdapterContexto,
  ): Promise<{ externalId?: string }> {
    const owner = this.ownerDe(empresaId, ctx);
    if (this.viaEvolution) {
      const r = await this.evolution.enviarTexto(
        EvolutionService.instanceName(owner),
        peerId,
        texto,
      );
      return { externalId: r.key?.id };
    }
    if (!this.sessions.estaConectado(owner)) {
      throw new BusinessRuleException(
        owner.type === 'USUARIO'
          ? 'Seu WhatsApp pessoal não está conectado. Conecte em Integrações.'
          : 'WhatsApp da empresa não está conectado.',
      );
    }
    return this.sessions.enviarTexto(owner, peerId, texto);
  }

  /** Indicador "digitando…" (composing) / parou (paused). Best-effort. */
  async enviarPresenca(
    empresaId: string,
    peerId: string,
    estado: 'composing' | 'paused',
  ): Promise<void> {
    const owner: Owner = { type: 'EMPRESA', id: empresaId };
    if (this.viaEvolution) {
      await this.evolution.enviarPresenca(EvolutionService.instanceName(owner), peerId, estado);
      return;
    }
    await this.sessions.enviarPresenca(owner, peerId, estado);
  }

  async estaDisponivel(empresaId: string, proprietarioId?: string | null): Promise<boolean> {
    const owner = this.ownerDe(empresaId, proprietarioId ? { proprietarioId } : undefined);
    if (this.viaEvolution) {
      const st = await this.evolution
        .estado(EvolutionService.instanceName(owner))
        .catch(() => null);
      return st?.instance?.state === 'open';
    }
    return this.sessions.estaConectado(owner);
  }

  /**
   * Envia mídia (imagem/vídeo/áudio/documento). Roteia pro provider ativo.
   */
  async enviarMidia(
    empresaId: string,
    peerId: string,
    params: Parameters<typeof this.sessions.enviarMidia>[2],
    ctx?: CanalAdapterContexto,
  ): Promise<{ externalId?: string }> {
    const owner = this.ownerDe(empresaId, ctx);

    if (this.viaEvolution) {
      const instance = EvolutionService.instanceName(owner);
      // Resolve a mídia em URL ou base64 (Evolution aceita os dois).
      let media = params.url ?? '';
      if (!media && params.buffer) media = params.buffer.toString('base64');
      if (!media && params.storagePath) {
        const buf = await this.media.baixar(params.storagePath);
        media = buf ? buf.toString('base64') : '';
      }
      if (!media) throw new BusinessRuleException('Mídia sem conteúdo pra enviar.');
      if (params.tipo === 'AUDIO') {
        const r = await this.evolution.enviarAudio(instance, peerId, media);
        return { externalId: r.key?.id };
      }
      const r = await this.evolution.enviarMidia(instance, peerId, {
        mediatype:
          params.tipo === 'IMAGE' ? 'image' : params.tipo === 'VIDEO' ? 'video' : 'document',
        mimetype: params.mimetype,
        media,
        fileName: params.fileName,
        caption: params.caption,
      });
      return { externalId: r.key?.id };
    }

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
