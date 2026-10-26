import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { MullerBotService } from '@modules/mullerbot/mullerbot.service';
import { PushService } from '@modules/push/push.service';
import { KnowledgeSearchService } from '@modules/rag/knowledge-search.service';
import { TAG_HUMANO } from '@integrations/mercadolivre/ml-resposta-ia.service';
import {
  PROMPT_PENDENCIA,
  SCHEMA_PENDENCIA,
  clienteFalouPorUltimo,
  contextoDaPendencia,
  lerDecisao,
  type MensagemHistorico,
  type TipoPendenciaIa,
} from './pendencias-ia';

/** Trava por pendência: duas rodadas seguidas não respondem duas vezes. */
const TTL_TRAVA_S = 10 * 60;
const MAX_HISTORICO = 15;

/**
 * IA das pendências (fase 2, Léo 25/10). Liga por empresa em
 * `Empresa.config.pendenciasIa.ativo` (desligada por padrão); cada tipo pode
 * ser desligado em `desligados`. Pergunta de anúncio do ML fica com o robô
 * próprio do ML (já ligado) — aqui só se acompanha o "humano" dele.
 */
@Injectable()
export class PendenciasIaService {
  private readonly logger = new Logger(PendenciasIaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly bot: MullerBotService,
    private readonly push: PushService,
    @Optional() private readonly conhecimento?: KnowledgeSearchService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /** Config da empresa: ligada + tipos desligados. */
  async config(empresaId: string): Promise<{ ativo: boolean; desligados: string[] }> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const c = ((e?.config ?? {}) as { pendenciasIa?: { ativo?: boolean; desligados?: string[] } })
      .pendenciasIa;
    return { ativo: c?.ativo === true, desligados: c?.desligados ?? [] };
  }

  /** Passa a IA em cada pendência aberta que ainda não foi tratada. */
  async processar(empresaId: string): Promise<{ respondidas: number; humano: number }> {
    const cfg = await this.config(empresaId);
    if (!cfg.ativo) return { respondidas: 0, humano: 0 };
    const abertas = await this.prisma.pendenciaMarketplace.findMany({
      where: { empresaId, resolvidaEm: null, estado: null },
      orderBy: [{ prazo: { sort: 'asc', nulls: 'last' } }, { desde: 'asc' }],
      take: 50,
    });
    let respondidas = 0;
    const escaladas: string[] = [];
    for (const p of abertas) {
      if (cfg.desligados.includes(p.tipo)) continue;
      try {
        const r = await this.tratar(empresaId, p);
        if (r === 'respondida') respondidas++;
        if (r === 'humano') escaladas.push(p.titulo);
      } catch (err) {
        this.logger.warn(`[pendências IA] ${p.id} falhou: ${String(err)}`);
      }
    }
    if (escaladas.length) await this.avisarHumano(empresaId, escaladas);
    return { respondidas, humano: escaladas.length };
  }

  private async tratar(
    empresaId: string,
    p: {
      id: string;
      canal: string;
      tipo: string;
      chave: string;
      titulo: string;
      pedido: string | null;
    },
  ): Promise<'respondida' | 'humano' | 'pulada'> {
    const tipo = p.tipo as TipoPendenciaIa;
    const peerId = this.peerDa(p.canal, p.chave);

    // Pergunta de anúncio do ML: o robô do ML responde; aqui só se o humano foi pedido.
    if (p.canal === 'MARKETPLACE_ML' && p.chave.startsWith('q:')) {
      const conv = await this.prisma.conversation.findFirst({
        where: { empresaId, canal: 'MARKETPLACE_ML', peerId: p.chave },
        select: { tagsInternas: true },
      });
      if (conv?.tagsInternas.some((t) => t.toLowerCase() === TAG_HUMANO)) {
        await this.marcar(p.id, 'AGUARDANDO_HUMANO');
        return 'humano';
      }
      return 'pulada';
    }

    // Sem conversa onde escrever (devolução da Shopee não aceita texto livre): humano.
    const conv = peerId
      ? await this.prisma.conversation.findFirst({
          where: { empresaId, canal: p.canal as never, peerId },
          select: { id: true },
        })
      : null;
    if (!conv) {
      await this.registrar(
        empresaId,
        p.id,
        null,
        {
          acao: 'humano',
          resposta: '',
          motivo: 'canal sem conversa por texto (só no painel do marketplace)',
        },
        false,
        null,
        null,
      );
      await this.marcar(p.id, 'AGUARDANDO_HUMANO');
      return 'humano';
    }

    const msgs = await this.prisma.message.findMany({
      // Envio que FALHOU não conta como fala da loja (senão a IA nunca tenta de novo).
      where: { conversationId: conv.id, status: { not: 'FAILED' } },
      orderBy: { criadoEm: 'desc' },
      take: MAX_HISTORICO,
      select: { direction: true, conteudo: true },
    });
    const historico: MensagemHistorico[] = msgs
      .reverse()
      .filter((m) => m.conteudo?.trim())
      .map((m) => ({ daLoja: m.direction === 'OUTBOUND', texto: m.conteudo.slice(0, 800) }));
    // A loja já falou por último: nada a fazer (a próxima rodada fecha a pendência).
    if (!clienteFalouPorUltimo(historico)) return 'pulada';

    if (this.redis) {
      const trava = await this.redis.client
        .set(`pend:ia:${p.id}`, '1', 'EX', TTL_TRAVA_S, 'NX')
        .catch(() => 'OK');
      if (trava !== 'OK') return 'pulada';
    }

    const ultima = historico[historico.length - 1].texto;
    const conhecimento = this.conhecimento
      ? await this.conhecimento.buscar(empresaId, ultima, 4).catch(() => [])
      : [];
    const pedido = p.pedido ? await this.resumoDoPedido(empresaId, p.pedido) : null;
    const contexto = contextoDaPendencia({
      canal: p.canal,
      tipo,
      titulo: p.titulo,
      conhecimento,
      pedido,
      historico,
    });
    const r = await this.bot.gerarRespostaIa(empresaId, PROMPT_PENDENCIA, contexto, [], undefined, {
      responseFormat: SCHEMA_PENDENCIA,
    });
    const decisao = lerDecisao(r.texto);

    // Envia SEMPRE (resposta ou espera): a loja tem a última palavra.
    let erro: string | null = null;
    try {
      await this.inbox.responderComoBot(
        conv.id,
        decisao.resposta,
        `pend-ia:${p.id}:${msgs.length}`,
      );
    } catch (err) {
      erro = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    }
    await this.registrar(empresaId, p.id, conv.id, decisao, !erro, erro, r.modelo);
    if (erro || decisao.acao === 'humano') {
      await this.marcar(p.id, 'AGUARDANDO_HUMANO');
      return 'humano';
    }
    await this.marcar(p.id, 'RESPONDIDA_IA');
    return 'respondida';
  }

  /** Conversa no app que corresponde à pendência. */
  private peerDa(canal: string, chave: string): string | null {
    if (chave.startsWith('conv:') || chave.startsWith('pack:') || chave.startsWith('q:'))
      return chave;
    if (chave.startsWith('inc:')) {
      const id = chave.slice(4);
      return canal === 'MARKETPLACE_ML' ? `claim:${id}` : null;
    }
    return null;
  }

  private async resumoDoPedido(empresaId: string, numero: string): Promise<string | null> {
    const o = await this.prisma.marketplaceOrder.findFirst({
      where: { empresaId, numeroExterno: numero },
      select: { produtoNome: true, quantidade: true, situacao: true, status: true, pedidoEm: true },
    });
    if (!o) return null;
    return `${o.produtoNome} · ${o.quantidade} peça(s) · situação ${o.situacao ?? o.status} · feito em ${o.pedidoEm
      .toISOString()
      .slice(0, 10)}`;
  }

  private async marcar(pendenciaId: string, estado: 'RESPONDIDA_IA' | 'AGUARDANDO_HUMANO') {
    await this.prisma.pendenciaMarketplace.update({ where: { id: pendenciaId }, data: { estado } });
  }

  private async registrar(
    empresaId: string,
    pendenciaId: string,
    conversationId: string | null,
    d: { acao: string; resposta: string; motivo: string },
    enviada: boolean,
    erro: string | null,
    modelo: string | null,
  ) {
    await this.prisma.pendenciaRespostaIa.create({
      data: {
        empresaId,
        pendenciaId,
        conversationId,
        acao: d.acao,
        resposta: d.resposta,
        motivo: d.motivo || null,
        enviada,
        erro,
        modelo,
      },
    });
  }

  /** Push agrupado: o que a IA não resolveu e precisa de alguém. */
  private async avisarHumano(empresaId: string, titulos: string[]) {
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        status: 'ATIVO',
        role: { in: ['ADMIN', 'DIRECTOR'] },
        empresas: { some: { empresaId } },
      },
      select: { id: true },
    });
    const n = titulos.length;
    await this.push
      .enviar(
        usuarios.map((u) => u.id),
        {
          titulo: n === 1 ? '1 pendência precisa de você' : `${n} pendências precisam de você`,
          corpo: `A IA respondeu pedindo um momento e passou pra você: ${titulos.slice(0, 3).join(' · ')}${n > 3 ? '…' : ''}`,
          url: '/pendencias',
          tag: `pendencias-humano-${empresaId}`,
        },
      )
      .catch(() => 0);
  }

  /** Últimas respostas da IA de uma pendência (pra revisar na tela). */
  respostas(empresaId: string, pendenciaId: string) {
    return this.prisma.pendenciaRespostaIa.findMany({
      where: { empresaId, pendenciaId },
      orderBy: { criadoEm: 'desc' },
      take: 10,
    });
  }
}
