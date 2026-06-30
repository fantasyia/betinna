import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { InboxService } from '@modules/inbox/inbox.service';
import type { MensagemEntranteParams } from '@modules/inbox/inbox.types';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { ConversarIaService } from './conversar-ia.service';

/**
 * OrquestracaoLeadEventsService (Fase B) — ponte Inbox → Fluxos.
 *
 * Registra um hook na Inbox no boot. Quando chega uma mensagem entrante que
 * casa com um Lead (por telefone/e-mail): (1) dispara o gatilho LEAD_RESPONDEU
 * e (2) retoma execuções pausadas no nó "Conversar com IA" daquele lead.
 *
 * Best-effort: erro aqui não derruba o recebimento da mensagem (o hook da Inbox
 * já isola exceções; ainda assim tratamos defensivamente).
 */
@Injectable()
export class OrquestracaoLeadEventsService implements OnModuleInit {
  private readonly logger = new Logger(OrquestracaoLeadEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: FluxoEventBusService,
    private readonly inbox: InboxService,
    private readonly conversarIa: ConversarIaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.inbox.registrarLeadEventHook((params, resultado) => {
      void this.aoReceberMensagem(params, resultado);
    });
    this.logger.log('Hook de eventos de lead registrado na Inbox (gatilho LEAD_RESPONDEU)');
  }

  /** Resolve o lead da mensagem entrante e dispara o gatilho LEAD_RESPONDEU. */
  async aoReceberMensagem(
    params: MensagemEntranteParams,
    resultado: { conversationId: string; messageId: string; duplicada: boolean },
  ): Promise<void> {
    try {
      if (resultado.duplicada) return;
      const lead = await this.resolverLead(params.empresaId, params.peerTelefone, params.peerEmail);

      // Gatilho MENSAGEM_CANAL (Fase C) — toda mensagem entrante, com ou sem lead
      // (roteamento por canal: SAC/marketplace/redes). Filtre por {{canal}}/palavra-chave no fluxo.
      //
      // Dedup do split webhook+poll do Evolution: quando o mesmo recado físico chega 2x
      // com externalId diferente (inbox não casa como duplicada), um fluxo de palavra-chave
      // SEM nó IA dispararia 2x e mandaria 2 WhatsApps. Chave = conversa + hash do texto numa
      // janela curta. Fail-open se o Redis cair (não bloqueia o gatilho).
      const textoHash = createHash('sha1')
        .update(params.conteudo ?? '')
        .digest('hex')
        .slice(0, 16);
      const dedupKey = `fx:msgcanal:${params.empresaId}:${resultado.conversationId}:${textoHash}`;
      let primeira = true;
      try {
        primeira = await this.redis.setNxEx(dedupKey, '1', 60);
      } catch {
        primeira = true;
      }
      if (primeira) {
        await this.bus.disparar(params.empresaId, 'MENSAGEM_CANAL', {
          canal: params.canal,
          conversationId: resultado.conversationId,
          texto: params.conteudo,
          leadId: lead?.id ?? null,
        });
      }

      if (!lead) return;

      // Fase C — registra a última mensagem recebida do lead (spec §4).
      await this.prisma.lead
        .updateMany({
          where: { id: lead.id, empresaId: params.empresaId },
          data: { ultimaMensagemEm: new Date() },
        })
        .catch(() => undefined);

      await this.bus.disparar(params.empresaId, 'LEAD_RESPONDEU', {
        leadId: lead.id,
        conversationId: resultado.conversationId,
        telefone: params.peerTelefone ?? null,
        texto: params.conteudo,
      });

      // Se há um fluxo pausado no nó "Conversar com IA" esperando este lead,
      // retoma a conversa (a IA processa a resposta e pode classificar/avançar).
      const aguardando = await this.conversarIa.aguardandoPorLead(params.empresaId, lead.id);
      if (aguardando) {
        // Multimodal IGUAL ao bot geral: transcreve áudio / prepara imagem pra visão
        // antes de alimentar a IA (a Persona decide). Sem isso o fluxo via "[áudio]".
        const { mensagemIA, imagemDataUrl } = await this.conversarIa.prepararEntrada(
          params,
          resultado.messageId,
        );
        await this.conversarIa.retomar(
          aguardando.id,
          resultado.conversationId,
          mensagemIA,
          imagemDataUrl,
        );
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`aoReceberMensagem falhou: ${m}`);
    }
  }

  /** Match de lead por sufixo de telefone (8 últimos dígitos) ou e-mail. */
  private async resolverLead(
    empresaId: string,
    telefone?: string,
    email?: string,
  ): Promise<{ id: string } | null> {
    if (telefone) {
      const sufixo = telefone.replace(/\D/g, '').slice(-8);
      if (sufixo.length === 8) {
        // Match por sufixo de 8 dígitos normalizando o telefone ARMAZENADO (tira a
        // formatação) — MESMO método robusto do inbox (resolverClienteId) e do bot
        // (buscarLeadDoPeer), via índice de expressão `Lead_empresaId_telefoneSufixo_idx`.
        // O `contains: sufixo` antigo QUEBRAVA quando o lead tinha telefone formatado
        // ("97053-5832" tem hífen no meio do sufixo de 8 dígitos) → o lead nunca casava,
        // o `retomar` nunca era chamado e o nó "Conversar com IA" ficava preso em
        // AGUARDANDO (bot "parava de responder" depois do opener).
        const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Lead"
          WHERE "empresaId" = ${empresaId}
            AND RIGHT(REGEXP_REPLACE(COALESCE("contatoTelefone", ''), '[^0-9]', '', 'g'), 8) = ${sufixo}
          ORDER BY "atualizadoEm" DESC
          LIMIT 1
        `;
        if (rows[0]) return rows[0];
      }
    }
    if (email) {
      const lead = await this.prisma.lead.findFirst({
        where: { empresaId, contatoEmail: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (lead) return lead;
    }
    return null;
  }
}
