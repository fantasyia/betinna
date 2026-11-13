import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { CanalAdapterRegistry } from '@modules/inbox/canal-adapter.registry';
import { InboxService } from '@modules/inbox/inbox.service';
import type { CanalAdapter, CanalAdapterContexto } from '@modules/inbox/inbox.types';
import { BusinessRuleException } from '@shared/errors/app-exception';
import {
  peerDoComentario,
  type CanalComentario,
  type ComentarioRecebido,
} from './meta-comentarios';
import { MetaGraphClientService } from './meta-graph-client.service';
import type { FacebookCredenciais, InstagramCredenciais } from './meta.types';

/** Onde a resposta entra: o comentário-alvo gravado na conversa. */
export function alvoDaConversa(ctx?: CanalAdapterContexto): {
  alvoId: string;
  comentarioId: string;
} {
  const m = ctx?.metadata ?? {};
  const alvoId = typeof m.comentario_alvo_id === 'string' ? m.comentario_alvo_id : null;
  const comentarioId = typeof m.comentario_id === 'string' ? m.comentario_id : null;
  if (!alvoId || !comentarioId) {
    // Sem o id não há onde responder: falhar alto (passo FALHOU), nunca chutar.
    throw new BusinessRuleException('Conversa de comentário sem o id do comentário');
  }
  return { alvoId, comentarioId };
}

/**
 * Comentários de Facebook (Página) e Instagram no inbox (13/11).
 *
 * - Entrada: o webhook entrega o comentário já parseado (`receber`) e ele vira
 *   mensagem numa conversa por autor × publicação.
 * - Saída: dois adapters (FACEBOOK_COMENTARIO / INSTAGRAM_COMENTARIO). O
 *   `enviarTexto` responde em PÚBLICO no comentário mais recente da conversa;
 *   `responderNoPrivado` manda a DM única que a Meta permite por comentário.
 *
 * Token: o mesmo Page Access Token das DMs (conexão `facebook` / `instagram`).
 */
@Injectable()
export class MetaComentariosService implements OnModuleInit {
  private readonly logger = new Logger(MetaComentariosService.name);

  constructor(
    private readonly graph: MetaGraphClientService,
    private readonly integracoes: IntegracoesService,
    private readonly registry: CanalAdapterRegistry,
    private readonly inbox: InboxService,
  ) {}

  onModuleInit(): void {
    this.registry.registrar(this.adapter('FACEBOOK_COMENTARIO'));
    this.registry.registrar(this.adapter('INSTAGRAM_COMENTARIO'));
  }

  /** Comentário que chegou pelo webhook → mensagem no inbox. */
  async receber(empresaId: string, c: ComentarioRecebido, contaId: string): Promise<void> {
    const anuncio = c.anuncioId ? { id: c.anuncioId, titulo: c.anuncioTitulo ?? null } : null;
    await this.inbox.processarMensagemEntrante({
      empresaId,
      canal: c.canal,
      peerId: peerDoComentario(c.postId, c.autorId),
      peerNome: c.autorNome,
      tipo: 'TEXT',
      conteudo: c.texto,
      externalId: c.comentarioId,
      data: c.data,
      meta: {
        accountId: contaId,
        // Lidas pelo inbox e gravadas na Conversation.metadata (merge): a resposta
        // vai sempre no comentário MAIS RECENTE do autor naquela publicação.
        comentario_alvo_id: c.alvoId,
        comentario_id: c.comentarioId,
        comentario_post_id: c.postId,
        comentario_autor_id: c.autorId,
        ...(anuncio ? { comentario_anuncio: anuncio } : {}),
      },
    });
  }

  private adapter(canal: CanalComentario): CanalAdapter {
    const servico = canal === 'INSTAGRAM_COMENTARIO' ? 'instagram' : 'facebook';
    return {
      canal,
      enviarTexto: async (empresaId, _peerId, texto, ctx) => {
        const { alvoId } = alvoDaConversa(ctx);
        const creds = await this.credenciais(empresaId, servico);
        const r = await this.graph.responderComentario({
          canal,
          alvoId,
          pageAccessToken: creds.pageAccessToken,
          texto,
        });
        return { externalId: r.id };
      },
      responderNoPrivado: async (empresaId, _peerId, texto, ctx) => {
        const { comentarioId } = alvoDaConversa(ctx);
        const creds = await this.credenciais(empresaId, servico);
        const r = await this.graph.responderComentarioNoPrivado({
          senderEndpointId:
            servico === 'instagram'
              ? (creds as InstagramCredenciais).igUserId
              : (creds as FacebookCredenciais).pageId,
          pageAccessToken: creds.pageAccessToken,
          comentarioId,
          texto,
        });
        return { externalId: r.message_id };
      },
      estaDisponivel: async (empresaId) => {
        try {
          return (await this.integracoes.obterCredenciaisInternas(empresaId, servico)).ativo;
        } catch (err) {
          this.logger.debug(`Comentários ${canal}: sem conexão ${servico} — ${String(err)}`);
          return false;
        }
      },
    };
  }

  private async credenciais(
    empresaId: string,
    servico: 'facebook' | 'instagram',
  ): Promise<FacebookCredenciais | InstagramCredenciais> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, servico);
    return conn.credenciais as unknown as FacebookCredenciais | InstagramCredenciais;
  }
}
