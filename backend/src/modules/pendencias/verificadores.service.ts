import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { MLClientService } from '@integrations/mercadolivre/ml-client.service';
import { ShopeeClientService } from '@integrations/shopee/shopee-client.service';
import { ShopeeChatService } from '@integrations/shopee/shopee-chat.service';
import type { PendenciaAchada } from './pendencias';

/** Resultado por canal: `null` = a conferência falhou (não resolve nada desse canal). */
export type Achados = Map<string, PendenciaAchada[] | null>;

const SETE_DIAS = 7 * 86_400_000;

/**
 * Um "verificador" por marketplace (desenho genérico: Shein e outros entram
 * aqui). Cada um pergunta à API o que está esperando a loja. Reclamações e
 * devoluções vêm dos Incidentes, que o sincronismo de 10 min já mantém pela API.
 */
@Injectable()
export class VerificadoresService {
  private readonly logger = new Logger(VerificadoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly ml?: MLClientService,
    @Optional() private readonly shopee?: ShopeeClientService,
    @Optional() private readonly shopeeChat?: ShopeeChatService,
  ) {}

  async levantar(empresaId: string): Promise<Achados> {
    const out: Achados = new Map();
    const conexoes = await this.prisma.integracaoConexao.findMany({
      where: { empresaId, ativo: true, servico: { in: ['mercadolivre', 'shopee'] } },
      select: { servico: true },
    });
    const tem = new Set(conexoes.map((c) => c.servico));
    if (tem.has('mercadolivre') && this.ml) {
      out.set('MARKETPLACE_ML', await this.tentar('ML', () => this.mercadoLivre(empresaId)));
    }
    if (tem.has('shopee') && this.shopee) {
      out.set(
        'MARKETPLACE_SHOPEE',
        await this.tentar('Shopee', () => this.shopeeChatPend(empresaId)),
      );
    }
    // Incidentes (todos os canais conectados): o que está esperando a loja.
    const inc = await this.tentar('incidentes', () => this.incidentes(empresaId));
    for (const [canal, lista] of out) {
      if (lista && inc) lista.push(...inc.filter((i) => i.canal === canal));
    }
    return out;
  }

  private async tentar<T>(nome: string, f: () => Promise<T>): Promise<T | null> {
    try {
      return await f();
    } catch (err) {
      this.logger.warn(`[pendências] ${nome} falhou: ${String(err)}`);
      return null;
    }
  }

  // ─── Mercado Livre ───────────────────────────────────────────────────────

  private async mercadoLivre(empresaId: string): Promise<PendenciaAchada[]> {
    const ml = this.ml!;
    const achados: PendenciaAchada[] = [];
    // Perguntas no anúncio: a busca do LADO DO VENDEDOR (bate com o painel do
    // ML; a por seller_id traz pergunta de anúncio pausado — 29/09).
    const q = await ml.get<{
      questions?: Array<{ id: number; text: string; date_created: string; item_id: string }>;
    }>(empresaId, '/my/received_questions/search?status=UNANSWERED&limit=50&api_version=4');
    for (const p of q.questions ?? []) {
      achados.push({
        canal: 'MARKETPLACE_ML',
        tipo: 'PERGUNTA',
        chave: `q:${p.id}`,
        titulo: `Pergunta no anúncio ${p.item_id}`,
        detalhe: p.text.slice(0, 480),
        link: '/inbox',
        desde: new Date(p.date_created),
        anuncio: p.item_id,
      });
    }
    // Mensagens do pós-venda não lidas (por pedido/pack).
    try {
      const u = await ml.get<{ results?: Array<{ resource: string; count: number }> }>(
        empresaId,
        '/messages/unread?role=seller&tag=post_sale',
      );
      for (const r of u.results ?? []) {
        const pack = r.resource.match(/packs\/(\d+)/)?.[1];
        if (!pack || !r.count) continue;
        achados.push({
          canal: 'MARKETPLACE_ML',
          tipo: 'MENSAGEM',
          chave: `pack:${pack}`,
          titulo: `Mensagem do comprador no pedido ${pack}`,
          detalhe: `${r.count} não lida(s)`,
          link: '/inbox',
          pedido: pack,
        });
      }
    } catch (err) {
      this.logger.warn(`[pendências] ML mensagens não lidas: ${String(err)}`);
    }
    return achados;
  }

  // ─── Shopee ──────────────────────────────────────────────────────────────

  /**
   * Chat: conversa dos últimos 7 dias em que o comprador falou DEPOIS da última
   * resposta ESCRITA da loja (figurinha/cupom automático não conta). A
   * conversa também é importada pro inbox, pra dar pra responder pelo app.
   */
  private async shopeeChatPend(empresaId: string): Promise<PendenciaAchada[]> {
    const sh = this.shopee!;
    const creds = await sh.getCredenciais(empresaId);
    const shopId = Number(creds.shopId);
    const limite = Date.now() - SETE_DIAS;
    const ms = (t: unknown) => Number(String(t).slice(0, 13));
    const convs: Array<{
      conversation_id: string;
      to_name?: string;
      last_message_timestamp: number | string;
    }> = [];
    let next: string | undefined;
    for (let pag = 0; pag < 10; pag++) {
      const r = await sh.getShop<{
        response?: {
          conversations?: typeof convs;
          page_result?: { more?: boolean; next_cursor?: { next_message_time_nano?: string } };
        };
      }>(empresaId, '/api/v2/sellerchat/get_conversation_list', {
        direction: 'older',
        type: 'all',
        page_size: 50,
        ...(next ? { next_timestamp_nano: next } : {}),
      });
      const lista = r.response?.conversations ?? [];
      convs.push(...lista);
      const ult = lista[lista.length - 1];
      if (!r.response?.page_result?.more || !ult || ms(ult.last_message_timestamp) < limite) break;
      next = r.response.page_result.next_cursor?.next_message_time_nano;
      if (!next) break;
    }
    const achados: PendenciaAchada[] = [];
    for (const c of convs.filter((x) => ms(x.last_message_timestamp) >= limite)) {
      const r = await sh.getShop<{
        response?: {
          messages?: Array<{
            from_shop_id?: number;
            message_type?: string;
            created_timestamp?: number;
            content?: { text?: string };
          }>;
        };
      }>(empresaId, '/api/v2/sellerchat/get_message', {
        conversation_id: c.conversation_id,
        page_size: 25,
      });
      const msgs = [...(r.response?.messages ?? [])].sort(
        (a, b) => (a.created_timestamp ?? 0) - (b.created_timestamp ?? 0),
      );
      let ultimaLoja = -1;
      msgs.forEach((m, i) => {
        if (m.from_shop_id === shopId && m.message_type === 'text') ultimaLoja = i;
      });
      const esperando = msgs.filter((m, i) => i > ultimaLoja && m.from_shop_id !== shopId);
      if (!esperando.length) continue;
      const ultima = esperando[esperando.length - 1];
      achados.push({
        canal: 'MARKETPLACE_SHOPEE',
        tipo: 'MENSAGEM',
        chave: `conv:${c.conversation_id}`,
        titulo: `Mensagem de ${c.to_name ?? 'comprador'} sem resposta`,
        detalhe: (ultima.content?.text ?? `(${ultima.message_type ?? 'mensagem'})`).slice(0, 480),
        link: '/inbox',
        comprador: c.to_name ?? null,
        desde: esperando[0].created_timestamp
          ? new Date(esperando[0].created_timestamp * 1000)
          : null,
      });
      // Traz a conversa pro inbox (melhor esforço).
      await this.shopeeChat
        ?.processarConversation(empresaId, c.conversation_id)
        .catch(() => undefined);
    }
    return achados;
  }

  // ─── Incidentes (todos os canais) ────────────────────────────────────────

  private async incidentes(empresaId: string): Promise<PendenciaAchada[]> {
    const rows = await this.prisma.marketplaceIncident.findMany({
      where: { empresaId, status: { in: ['ABERTO', 'AGUARDANDO_VENDEDOR'] } },
      select: {
        id: true,
        canal: true,
        tipo: true,
        externalId: true,
        resumo: true,
        motivo: true,
        pedidoExternoId: true,
        prazoResposta: true,
        abertoEm: true,
      },
      take: 500,
    });
    return rows.map((i) => ({
      canal: i.canal,
      tipo: i.tipo === 'DEVOLUCAO' ? ('DEVOLUCAO' as const) : ('RECLAMACAO' as const),
      chave: `inc:${i.externalId}`,
      titulo:
        (i.tipo === 'DEVOLUCAO' ? 'Devolução' : 'Reclamação') +
        (i.pedidoExternoId ? ` do pedido ${i.pedidoExternoId}` : ''),
      detalhe: (i.resumo ?? i.motivo ?? '').slice(0, 480) || null,
      link: `/incidentes?id=${i.id}`,
      desde: i.abertoEm,
      prazo: i.prazoResposta,
      pedido: i.pedidoExternoId,
    }));
  }
}
