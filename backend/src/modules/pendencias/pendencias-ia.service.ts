import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { MullerBotService } from '@modules/mullerbot/mullerbot.service';
import { PushService } from '@modules/push/push.service';
import { KnowledgeSearchService } from '@modules/rag/knowledge-search.service';
import { TAG_HUMANO } from '@integrations/mercadolivre/ml-resposta-ia.service';
import { ShopeeClientService } from '@integrations/shopee/shopee-client.service';
import {
  PROMPT_PENDENCIA,
  SCHEMA_PENDENCIA,
  baseParaConversa,
  cardsDoHistorico,
  clienteFalouPorUltimo,
  clienteTerminou,
  contextoDaPendencia,
  SILENCIO_S,
  lerDecisao,
  textoLegivel,
  type AnuncioContexto,
  type MensagemHistorico,
  type TipoPendenciaIa,
} from './pendencias-ia';

/** Mensagens (mais nova primeiro) → histórico que a IA lê (mais antiga primeiro). */
function paraHistorico(
  msgs: Array<{ direction: string; conteudo: string | null; tipo: string }>,
): MensagemHistorico[] {
  return (
    [...msgs]
      .reverse()
      .filter((m) => m.conteudo?.trim())
      // Figurinha/cupom automático da loja não é resposta (mesmo critério da
      // rotina, 25/10): só TEXTO da loja conta como "a loja falou".
      .filter((m) => m.direction !== 'OUTBOUND' || m.tipo === 'TEXT')
      .map((m) => ({ daLoja: m.direction === 'OUTBOUND', texto: (m.conteudo ?? '').slice(0, 800) }))
  );
}

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
export class PendenciasIaService implements OnModuleInit {
  private readonly logger = new Logger(PendenciasIaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly bot: MullerBotService,
    private readonly push: PushService,
    @Optional() private readonly conhecimento?: KnowledgeSearchService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly shopee?: ShopeeClientService,
  ) {}

  /** Última mensagem de cliente por conversa (o relógio do silêncio). */
  private readonly ultimaFala = new Map<string, number>();

  onModuleInit(): void {
    this.inbox.registrarChatMarketplaceHook((params, r) => {
      if (r.duplicada) return;
      this.agendarChat(params.empresaId, params.canal, params.peerId, r.conversationId);
    });
  }

  /**
   * Resposta NA HORA (Léo, 26/10): cada mensagem do cliente zera um relógio de
   * 30 s daquela conversa. Quando ele fica 30 s quieto, a IA lê a conversa
   * inteira de uma vez, interpreta e responde — sem cortar o raciocínio dele.
   * A rodada de 15 min continua como rede (aviso perdido, deploy no meio).
   */
  agendarChat(empresaId: string, canal: string, peerId: string, conversationId: string): void {
    if (!/^(conv|pack):/.test(peerId)) return;
    const marca = Date.now();
    this.ultimaFala.set(conversationId, marca);
    setTimeout(
      () => {
        if (this.ultimaFala.get(conversationId) !== marca) return; // ele escreveu de novo
        this.ultimaFala.delete(conversationId);
        void this.responderChat(empresaId, canal, peerId).catch((err) =>
          this.logger.warn(`[pendências IA] chat ${peerId} falhou: ${String(err)}`),
        );
      },
      (SILENCIO_S + 1) * 1000,
    ).unref?.();
  }

  /** Garante a pendência do chat e passa a IA nela (se a empresa ligou). */
  async responderChat(empresaId: string, canal: string, peerId: string): Promise<void> {
    const cfg = await this.config(empresaId);
    if (!cfg.ativo || cfg.desligados.includes('MENSAGEM')) return;
    const chave = { empresaId, canal, tipo: 'MENSAGEM', chave: peerId };
    let p = await this.prisma.pendenciaMarketplace.findUnique({
      where: { empresaId_canal_tipo_chave: chave },
    });
    // Passou pra equipe: a IA não volta a falar por cima de quem atende.
    if (p?.estado === 'AGUARDANDO_HUMANO' && !p.resolvidaEm) return;
    if (!p) {
      const conv = await this.prisma.conversation.findFirst({
        where: { empresaId, canal: canal as never, peerId },
        select: { peerNome: true },
      });
      const nome = conv?.peerNome?.replace(/^Comprador Shopee #/, '') || 'comprador';
      p = await this.prisma.pendenciaMarketplace.create({
        data: {
          ...chave,
          titulo: `Mensagem de ${nome} sem resposta`.slice(0, 200),
          link: '/inbox',
          comprador: conv?.peerNome?.slice(0, 120) ?? null,
          desde: new Date(),
        },
      });
    } else if (p.resolvidaEm || p.estado === 'RESPONDIDA_IA') {
      // Cliente falou de novo: é conversa nova pra IA.
      p = await this.prisma.pendenciaMarketplace.update({
        where: { id: p.id },
        data: { resolvidaEm: null, avisadaEm: null, lembreteEm: null, estado: null },
      });
    }
    const r = await this.tratar(empresaId, p);
    if (r === 'humano') await this.avisarHumano(empresaId, [p.titulo]);
  }

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

    const msgs = await this.mensagens(conv.id);
    const historico = paraHistorico(msgs);
    // A loja já falou por último: nada a fazer (a próxima rodada fecha a pendência).
    if (!clienteFalouPorUltimo(historico)) return 'pulada';
    // Cliente ainda escrevendo (card + pergunta em seguida): espera o silêncio.
    const ultimaDoCliente = msgs.find((m) => m.direction === 'INBOUND');
    if (ultimaDoCliente && !clienteTerminou(ultimaDoCliente.criadoEm)) return 'pulada';

    if (this.redis) {
      // Trava por FALA do cliente (não pela pendência): duas rodadas não respondem
      // a mesma fala, mas a próxima fala dele é respondida na hora.
      const fala = ultimaDoCliente?.criadoEm.getTime() ?? 0;
      const trava = await this.redis.client
        .set(`pend:ia:${p.id}:${fala}`, '1', 'EX', TTL_TRAVA_S, 'NX')
        .catch(() => 'OK');
      if (trava !== 'OK') return 'pulada';
    }

    const { decisao, modelo } = await this.decidir(empresaId, p, tipo, historico);

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
    await this.registrar(empresaId, p.id, conv.id, decisao, !erro, erro, modelo);
    if (erro || decisao.acao === 'humano') {
      await this.marcar(p.id, 'AGUARDANDO_HUMANO');
      return 'humano';
    }
    await this.marcar(p.id, 'RESPONDIDA_IA');
    return 'respondida';
  }

  /** Últimas mensagens da conversa (envio que FALHOU não conta como fala da loja). */
  private async mensagens(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversationId, status: { not: 'FAILED' } },
      orderBy: { criadoEm: 'desc' },
      take: MAX_HISTORICO,
      select: { direction: true, conteudo: true, tipo: true, criadoEm: true },
    });
  }

  /**
   * O que a IA decide pra esta conversa — a base INTEIRA (Léo, 26/10: a busca
   * por trecho errava quando a última fala era card ou figurinha), os pedidos e
   * os anúncios citados. Não envia nada: quem envia é o `tratar`.
   */
  private async decidir(
    empresaId: string,
    p: { canal: string; titulo: string; pedido: string | null },
    tipo: TipoPendenciaIa,
    historico: MensagemHistorico[],
  ) {
    const cards = cardsDoHistorico(historico);
    const numeros = [...new Set([...(p.pedido ? [p.pedido] : []), ...cards.pedidos])].slice(0, 3);
    const pedidos = await Promise.all(numeros.map((n) => this.resumoDoPedido(empresaId, n)));
    const pedido = pedidos.map((x) => x.texto).join('\n') || null;
    const anuncios =
      p.canal === 'MARKETPLACE_SHOPEE'
        ? await this.anunciosShopee(empresaId, cards.itens, numeros)
        : [];
    // Anúncio + ficha do produto (economia de token, Léo 26/10); a base
    // inteira só quando a conversa não tem produto.
    const conhecimento = baseParaConversa(await this.baseInteira(empresaId), [
      ...anuncios.map((a) => a.nome),
      ...pedidos.flatMap((x) => x.titulos),
    ]);
    const contexto = contextoDaPendencia({
      canal: p.canal,
      tipo,
      titulo: p.titulo,
      conhecimento,
      pedido,
      anuncios,
      historico,
    });
    const r = await this.bot.gerarRespostaIa(empresaId, PROMPT_PENDENCIA, contexto, [], undefined, {
      responseFormat: SCHEMA_PENDENCIA,
    });
    return { decisao: lerDecisao(r.texto), modelo: r.modelo, anuncios };
  }

  /**
   * "Testar a IA" (26/10): o que ela responderia nas últimas conversas REAIS,
   * sem enviar nada nem gravar. Cada conversa é cortada na última fala do
   * cliente — é o ponto em que a IA entraria.
   */
  async simular(empresaId: string, limite = 10) {
    const pendencias = await this.prisma.pendenciaMarketplace.findMany({
      where: {
        empresaId,
        canal: { in: ['MARKETPLACE_SHOPEE', 'MARKETPLACE_ML'] },
        OR: [{ chave: { startsWith: 'conv:' } }, { chave: { startsWith: 'pack:' } }],
      },
      orderBy: { atualizadoEm: 'desc' },
      take: limite,
    });
    const out: Array<{
      id: string;
      titulo: string;
      comprador: string | null;
      conversa: string[];
      acao: string;
      resposta: string;
      motivo: string;
    }> = [];
    for (const p of pendencias) {
      const peerId = this.peerDa(p.canal, p.chave);
      const conv = peerId
        ? await this.prisma.conversation.findFirst({
            where: { empresaId, canal: p.canal as never, peerId },
            select: { id: true },
          })
        : null;
      if (!conv) continue;
      const historico = paraHistorico(await this.mensagens(conv.id));
      let fim = historico.length;
      while (fim > 0 && historico[fim - 1].daLoja) fim--;
      const ate = historico.slice(0, fim);
      if (!ate.length) continue;
      try {
        const { decisao, anuncios } = await this.decidir(
          empresaId,
          p,
          p.tipo as TipoPendenciaIa,
          ate,
        );
        out.push({
          id: p.id,
          titulo: p.titulo,
          comprador: p.comprador,
          conversa: ate
            .slice(-6)
            .map((m) => `${m.daLoja ? 'Loja' : 'Cliente'}: ${textoLegivel(m.texto, anuncios)}`),
          ...decisao,
        });
      } catch (err) {
        this.logger.warn(`[pendências IA] simular ${p.id}: ${String(err)}`);
      }
    }
    return out;
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

  /** Base de conhecimento ativa da empresa, inteira (pós-venda e produtos primeiro). */
  private async baseInteira(empresaId: string) {
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: { empresaId, ativo: true },
      select: { titulo: true, conteudo: true, categoria: true },
      orderBy: { titulo: 'asc' },
    });
    const peso = (c: string | null) => (c === 'pos_venda' ? 0 : c === 'produtos' ? 1 : 2);
    return rows.sort((a, b) => peso(a.categoria) - peso(b.categoria));
  }

  /** Pedido como a IA precisa: itens com variação, situação, rastreio e datas. */
  private async resumoDoPedido(
    empresaId: string,
    numero: string,
  ): Promise<{ texto: string; titulos: string[] }> {
    const o = await this.prisma.marketplaceOrder.findFirst({
      where: { empresaId, numeroExterno: numero },
      select: {
        numeroExterno: true,
        produtoNome: true,
        quantidade: true,
        itens: true,
        situacao: true,
        status: true,
        rastreio: true,
        pedidoEm: true,
        enviadoEm: true,
        entregueEm: true,
      },
    });
    if (!o) return { texto: `Pedido ${numero}: não encontrado no app.`, titulos: [] };
    const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const lista = Array.isArray(o.itens)
      ? (o.itens as Array<{ titulo?: string; variacao?: string; quantidade?: number }>)
      : [];
    const itens = lista.length
      ? lista
          .map(
            (i) =>
              `${i.quantidade ?? 1}x ${i.titulo ?? '?'}${i.variacao ? ` (${i.variacao})` : ''}`,
          )
          .join('; ')
      : `${o.quantidade}x ${o.produtoNome}`;
    const titulos = lista.length
      ? lista.map((i) => i.titulo ?? '').filter(Boolean)
      : [o.produtoNome];
    const texto = [
      `Pedido ${o.numeroExterno}: ${itens}`,
      `situação: ${o.situacao ?? o.status}`,
      `feito em ${dia(o.pedidoEm)}`,
      o.enviadoEm ? `enviado em ${dia(o.enviadoEm)}` : 'ainda não enviado',
      o.entregueEm ? `entregue em ${dia(o.entregueEm)}` : null,
      o.rastreio ? `rastreio ${o.rastreio}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return { texto, titulos };
  }

  /**
   * Anúncios da Shopee citados na conversa (card do produto) ou nos pedidos:
   * título + descrição do anúncio (onde costuma estar a tabela de medidas).
   */
  private async anunciosShopee(
    empresaId: string,
    itemIds: string[],
    pedidos: string[],
  ): Promise<AnuncioContexto[]> {
    if (!this.shopee) return [];
    const ids = new Set(itemIds.filter((x) => /^\d+$/.test(x)));
    if (pedidos.length) {
      const r = await this.shopee
        .getShop<{
          response?: { order_list?: Array<{ item_list?: Array<{ item_id?: number }> }> };
        }>(empresaId, '/api/v2/order/get_order_detail', {
          order_sn_list: pedidos.join(','),
          response_optional_fields: 'item_list',
        })
        .catch(() => null);
      for (const o of r?.response?.order_list ?? [])
        for (const i of o.item_list ?? []) if (i.item_id) ids.add(String(i.item_id));
    }
    if (!ids.size) return [];
    const r = await this.shopee
      .getShop<{
        response?: {
          item_list?: Array<{
            item_id: number;
            item_name?: string;
            description?: string;
            description_info?: {
              extended_description?: { field_list?: Array<{ field_type?: string; text?: string }> };
            };
          }>;
        };
      }>(empresaId, '/api/v2/product/get_item_base_info', {
        item_id_list: [...ids].slice(0, 10).join(','),
      })
      .catch(() => null);
    return (r?.response?.item_list ?? []).map((i) => ({
      id: String(i.item_id),
      nome: i.item_name ?? `anúncio ${i.item_id}`,
      descricao:
        i.description ??
        (i.description_info?.extended_description?.field_list ?? [])
          .filter((f) => f.field_type === 'text' && f.text)
          .map((f) => f.text)
          .join('\n'),
    }));
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
