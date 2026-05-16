import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { MessageChannel } from '@prisma/client';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CanalAdapterRegistry } from '@modules/inbox/canal-adapter.registry';
import type { CanalAdapter } from '@modules/inbox/inbox.types';
import { MetaGraphClientService } from './meta-graph-client.service';
import type { InstagramCredenciais } from './meta.types';

/**
 * Adapter de Instagram Direct pra Inbox unificada.
 *
 * Mesmo endpoint do Messenger (`POST /{senderEndpoint}/messages`), mas o
 * `senderEndpoint` é o IG Business Account ID. O token continua sendo o
 * Page Access Token da page vinculada ao IG.
 */
@Injectable()
export class InstagramService implements CanalAdapter, OnModuleInit {
  readonly canal: MessageChannel = 'INSTAGRAM';

  constructor(
    private readonly graph: MetaGraphClientService,
    private readonly integracoes: IntegracoesService,
    private readonly registry: CanalAdapterRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.registrar(this);
  }

  async enviarTexto(
    empresaId: string,
    peerId: string,
    texto: string,
  ): Promise<{ externalId?: string }> {
    const creds = await this.resolverCredenciais(empresaId);
    const r = await this.graph.enviarTexto({
      senderEndpointId: creds.igUserId,
      pageAccessToken: creds.pageAccessToken,
      recipientPsid: peerId,
      texto,
      messagingType: 'RESPONSE',
    });
    return { externalId: r.message_id };
  }

  async estaDisponivel(empresaId: string): Promise<boolean> {
    try {
      const c = await this.integracoes.obterCredenciaisInternas(empresaId, 'instagram');
      return c.ativo;
    } catch {
      return false;
    }
  }

  private async resolverCredenciais(empresaId: string): Promise<InstagramCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'instagram');
    return conn.credenciais as unknown as InstagramCredenciais;
  }
}
