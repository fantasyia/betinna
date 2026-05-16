import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { MessageChannel } from '@prisma/client';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CanalAdapterRegistry } from '@modules/inbox/canal-adapter.registry';
import type { CanalAdapter } from '@modules/inbox/inbox.types';
import { MetaGraphClientService } from './meta-graph-client.service';
import type { FacebookCredenciais } from './meta.types';

/**
 * Adapter de Facebook Messenger pra Inbox unificada.
 *
 * Envia mensagens via Graph API `POST /{pageId}/messages` com Page Access Token
 * resolvido das credenciais cifradas em `IntegracaoConexao`.
 *
 * Disponibilidade: simplesmente checa se há `IntegracaoConexao(servico='facebook')`
 * ativa pra empresa. O token pode estar expirado e a chamada falhar; deixamos a
 * `enviarTexto` lançar nesse caso — a Inbox lida com FAILED + meta.erro.
 */
@Injectable()
export class FacebookService implements CanalAdapter, OnModuleInit {
  readonly canal: MessageChannel = 'FACEBOOK';

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
      senderEndpointId: creds.pageId,
      pageAccessToken: creds.pageAccessToken,
      recipientPsid: peerId,
      texto,
      messagingType: 'RESPONSE',
    });
    return { externalId: r.message_id };
  }

  async estaDisponivel(empresaId: string): Promise<boolean> {
    try {
      const c = await this.integracoes.obterCredenciaisInternas(empresaId, 'facebook');
      return c.ativo;
    } catch {
      return false;
    }
  }

  private async resolverCredenciais(empresaId: string): Promise<FacebookCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'facebook');
    return conn.credenciais as unknown as FacebookCredenciais;
  }
}
