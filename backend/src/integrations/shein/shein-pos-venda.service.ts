import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { IncidentsService } from '@modules/incidents/incidents.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { horaShein } from './shein-assinatura';
import { conversaShein, type SheinPosVenda } from './shein-pos-venda';
import { SheinClientService } from './shein.client';

export interface SheinPosVendaResumo {
  aftersalesOrderNo: string;
  aftersalesOrderSubStatus?: number;
  requestTime?: string;
  updateTime?: string;
}

const JANELA_MS = 48 * 3_600_000;
const POR_PAGINA = 30;
const POR_DETALHE = 10;

/**
 * Pós-venda da Shein → Incidentes (Léo, 01/11). Lista em janelas de 48 h
 * (UTC+8), detalhe de 10 em 10, e cada caso vira MarketplaceIncident do canal
 * MARKETPLACE_SHEIN — a rotina de pendências avisa o que espera a loja.
 * A API da Shein não tem chat: o atendimento é este pós-venda. Desde 14/11
 * cada caso também vira conversa SÓ LEITURA no Inbox ("Pós-venda Shein #nº"),
 * no molde da "Reclamação ML #id" — sem adapter de envio, responder dá 422.
 */
@Injectable()
export class SheinPosVendaService {
  private readonly logger = new Logger(SheinPosVendaService.name);

  constructor(
    private readonly shein: SheinClientService,
    private readonly incidents: IncidentsService,
    private readonly inbox: InboxService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Um caso → conversa do Inbox + incidente ligado a ela. Idempotente pela
   * chave do caso (peerId `posvenda:<nº>`): reprocessar o mesmo estado não
   * acrescenta mensagem nem mexe no status que a equipe deu à conversa.
   */
  async registrar(empresaId: string, d: SheinPosVenda): Promise<void> {
    const c = conversaShein(d);
    const conversationId = await this.levarAoInbox(empresaId, d, c);
    await this.incidents.registrarIncidente({
      empresaId,
      canal: 'MARKETPLACE_SHEIN',
      ...c.incidente,
      conversationId,
      metadata: { shein_pos_venda: d },
    });
  }

  /**
   * Backfill (14/11): incidente da Shein gravado antes do Inbox (sem conversa)
   * ganha a sua a partir do detalhe guardado no próprio incidente — sem chamar
   * a Shein e sem regravar o incidente (o `resolvidoEm` dele fica como está).
   * Roda junto do cron; depois do primeiro passe não acha nada.
   */
  async garantirConversas(empresaId: string, limite = 100): Promise<number> {
    const orfaos = await this.prisma.marketplaceIncident.findMany({
      where: { empresaId, canal: 'MARKETPLACE_SHEIN', conversations: { none: {} } },
      select: { id: true, metadata: true },
      take: limite,
    });
    let n = 0;
    for (const o of orfaos) {
      const d = (o.metadata as { shein_pos_venda?: SheinPosVenda } | null)?.shein_pos_venda;
      if (!d?.aftersalesOrderNo) continue;
      try {
        const conversationId = await this.levarAoInbox(empresaId, d, conversaShein(d));
        if (!conversationId) continue;
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { incidentId: o.id },
        });
        n++;
      } catch (err) {
        this.logger.warn(`[Shein] conversa do pós-venda ${d.aftersalesOrderNo}: ${String(err)}`);
      }
    }
    return n;
  }

  /**
   * Grava o resumo do caso como mensagem SYSTEM da conversa `posvenda:<nº>`.
   * Mensagem nova = a situação mudou: o status da conversa segue o caso (a
   * entrada sempre marca PENDENTE; só o que espera a loja deve ficar assim).
   * Devolve a conversa — undefined quando a marca de limpeza do canal barrou.
   */
  private async levarAoInbox(
    empresaId: string,
    d: SheinPosVenda,
    c: ReturnType<typeof conversaShein>,
  ): Promise<string | undefined> {
    const r = await this.inbox.processarMensagemEntrante({
      empresaId,
      canal: 'MARKETPLACE_SHEIN',
      peerId: c.peerId,
      peerNome: c.peerNome,
      tipo: 'SYSTEM',
      conteudo: c.conteudo,
      externalId: c.externalId,
      meta: {
        shein_aftersales_no: d.aftersalesOrderNo,
        shein_order_no: d.orderNo ?? null,
        shein_sub_status: d.aftersalesOrderSubStatus ?? null,
        categoria: c.categoria,
      },
    });
    if (!r.conversationId) return undefined;
    if (!r.duplicada && c.statusConversa !== 'PENDENTE') {
      await this.prisma.conversation.update({
        where: { id: r.conversationId },
        data: {
          status: c.statusConversa,
          ...(c.statusConversa === 'RESOLVIDA' ? { naoLidas: 0 } : {}),
        },
      });
    }
    return r.conversationId;
  }

  /** Uma janela de até 48 h. tipo 1 = abertos · 2 = atualizados. */
  async listarJanela(empresaId: string, ini: Date, fim: Date, tipo: 1 | 2) {
    const casos: SheinPosVendaResumo[] = [];
    let total = 0;
    for (let page = 1; page <= 334; page++) {
      const r = await this.shein.post<{ count?: number; list?: SheinPosVendaResumo[] }>(
        empresaId,
        '/open-api/after-sales-order/list',
        {
          queryType: tipo,
          startTime: horaShein(ini),
          endTime: horaShein(fim),
          page,
          pageSize: POR_PAGINA,
        },
      );
      total = r?.count ?? 0;
      const lista = r?.list ?? [];
      casos.push(...lista);
      if (lista.length < POR_PAGINA || casos.length >= total) break;
    }
    return { total, casos };
  }

  /** As últimas `horas` (máx. 48), cru — pra conferência. */
  listar(empresaId: string, horas: number, tipo: 1 | 2 = 2) {
    const fim = new Date();
    return this.listarJanela(
      empresaId,
      new Date(fim.getTime() - Math.min(horas, 48) * 3_600_000),
      fim,
      tipo,
    );
  }

  /** Detalhe de até 10 casos. */
  detalhe(empresaId: string, numeros: string[]) {
    return this.shein.post<SheinPosVenda[]>(empresaId, '/open-api/after-sales-order/details', {
      aftersalesOrderNos: numeros.slice(0, POR_DETALHE),
    });
  }

  /** Um caso só (aviso do webhook): busca o detalhe e grava em Incidentes. */
  async sincronizarCaso(empresaId: string, numero: string): Promise<boolean> {
    const [d] = (await this.detalhe(empresaId, [numero])) ?? [];
    if (!d) return false;
    await this.registrar(empresaId, d);
    return true;
  }

  /** Grava em Incidentes (e no Inbox) tudo de `desde` até agora, de 48 em 48 h. */
  async sincronizar(
    empresaId: string,
    desde: Date,
    tipo: 1 | 2,
  ): Promise<{ casos: number; falhas: number }> {
    const agora = Date.now();
    let n = 0;
    let falhas = 0;
    for (let ini = desde.getTime(); ini < agora; ini += JANELA_MS) {
      const fim = new Date(Math.min(ini + JANELA_MS, agora));
      const { casos } = await this.listarJanela(empresaId, new Date(ini), fim, tipo);
      const numeros = [...new Set(casos.map((c) => c.aftersalesOrderNo))];
      for (let i = 0; i < numeros.length; i += POR_DETALHE) {
        const detalhes = (await this.detalhe(empresaId, numeros.slice(i, i + POR_DETALHE))) ?? [];
        for (const d of detalhes) {
          try {
            await this.registrar(empresaId, d);
            n++;
          } catch (err) {
            falhas++;
            this.logger.warn(`[Shein] pós-venda ${d.aftersalesOrderNo} não gravou: ${String(err)}`);
          }
        }
      }
    }
    return { casos: n, falhas };
  }
}
