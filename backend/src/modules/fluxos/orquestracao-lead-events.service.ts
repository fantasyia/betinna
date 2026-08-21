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
      // O TIMESTAMP físico entra na chave (auditoria 20/08): o split
      // webhook+poll entrega o MESMO recado com o mesmo messageTimestamp — mas
      // duas mensagens genuínas de texto igual ("sim" duas vezes em 60s) têm
      // timestamps diferentes. Sem ele, a segunda era engolida: nem gatilho,
      // nem o turno da IA — o lead respondia e nada acontecia.
      const tsFisico = params.data ? Math.floor(params.data.getTime() / 1000) : 0;
      const dedupKey = `fx:msgcanal:${params.empresaId}:${resultado.conversationId}:${textoHash}:${tsFisico}`;
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
          // Dual-owner (D38): null/ausente = WhatsApp CENTRAL da empresa;
          // preenchido = WhatsApp PESSOAL do rep dono da sessão. O gatilho filtra
          // por isso (`escopo`) — sem este campo, mensagem no celular do rep
          // disparava a triagem da empresa e virava lead na Triagem.
          proprietarioId: params.proprietarioId ?? null,
        });
      }

      if (!lead) return;

      // AUDITORIA (média): quando a pessoa tem lead DUPLICADO (mesmo telefone,
      // dois ids), `lead.id` é o mais recente — mas a execução viva pode estar no
      // irmão. O carimbo de última mensagem e o LEAD_RESPONDEU saíam com o id
      // ERRADO: o lead "B" ficava marcado como quem respondeu e disparava as
      // réguas, enquanto a conversa real acontecia no "A". Carimba TODOS os
      // irmãos (é a mesma pessoa) e resolve o id do evento ANTES de disparar.
      const idsDaPessoa = [...new Set([lead.id, ...(lead.idsIrmaos ?? [])])];
      await this.prisma.lead
        .updateMany({
          where: { id: { in: idsDaPessoa }, empresaId: params.empresaId },
          data: { ultimaMensagemEm: new Date() },
        })
        .catch(() => undefined);

      // O MESMO `primeira` do dedup acima: o recado físico chega DUAS vezes
      // (webhook do Evolution + poll de fallback). Sem o guard, LEAD_RESPONDEU
      // disparava 2x e o retomar rodava o turno da IA em dobro pro mesmo texto —
      // o cliente via a resposta duplicada. A chave já identifica o recado
      // (empresa+conversa+hash do texto) e o fail-open preserva o comportamento
      // com o Redis fora.
      if (!primeira) return;

      // Resolve a execução ANTES de disparar: se ela está num irmão, é ESSE o id
      // que representa a conversa viva, e é ele que tem que ir no evento.
      let aguardando = await this.conversarIa.aguardandoPorLead(params.empresaId, lead.id);
      let leadIdEvento = lead.id;
      if (!aguardando) {
        for (const outroId of idsDaPessoa) {
          if (outroId === lead.id) continue;
          aguardando = await this.conversarIa.aguardandoPorLead(params.empresaId, outroId);
          if (aguardando) {
            leadIdEvento = outroId;
            this.logger.log(
              `Retomada resolvida por lead DUPLICADO: execução estava no lead ${outroId} ` +
                `(principal ${lead.id}) — LEAD_RESPONDEU sai com o id da execução viva`,
            );
            break;
          }
        }
      }

      await this.bus.disparar(params.empresaId, 'LEAD_RESPONDEU', {
        leadId: leadIdEvento,
        conversationId: resultado.conversationId,
        telefone: params.peerTelefone ?? null,
        texto: params.conteudo,
      });
      // A PORTA tem que bater (auditoria 20/08): a execução foi aberta numa
      // conversa com um dono (empresa = null, ou o WhatsApp pessoal de um rep),
      // e a resposta da IA sai por ESSA porta (donoDaConversa do contexto). Se
      // o lead escreve no WhatsApp PESSOAL do rep e a execução viva é da
      // conversa da EMPRESA, retomar aqui faria a IA responder pela empresa a
      // uma mensagem que chegou no número do rep — conversa cruzada. O
      // LEAD_RESPONDEU acima continua disparando (é evento de lead, não turno).
      const portaDaMensagem = params.proprietarioId ?? null;
      if (aguardando && (aguardando.proprietarioId ?? null) !== portaDaMensagem) {
        this.logger.log(
          `Retomar PULADO: mensagem chegou na porta ${portaDaMensagem ?? 'empresa'} e a ` +
            `execução ${aguardando.id} é da porta ${aguardando.proprietarioId ?? 'empresa'} — ` +
            'turno da IA não cruza conversas',
        );
        aguardando = null;
      }
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
  ): Promise<{ id: string; idsIrmaos?: string[] } | null> {
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
        // SEM LIMIT 1: leads DUPLICADOS (mesma pessoa, ids diferentes) são comuns
        // na base. O principal segue sendo o mais recente, mas os "irmãos" vão
        // junto — a execução da IA pode estar presa em um deles, e sem isso o
        // retomar não achava nada e a conversa morria em silêncio.
        const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Lead"
          WHERE "empresaId" = ${empresaId}
            AND RIGHT(REGEXP_REPLACE(COALESCE("contatoTelefone", ''), '[^0-9]', '', 'g'), 8) = ${sufixo}
          ORDER BY "atualizadoEm" DESC
          LIMIT 10
        `;
        if (rows[0]) return { id: rows[0].id, idsIrmaos: rows.map((r) => r.id) };
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
