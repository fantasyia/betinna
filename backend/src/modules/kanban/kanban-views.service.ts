import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { USUARIO_RESUMO } from './kanban.constants';
import type { CalendarioQueryDto } from './kanban.dto';

/**
 * ★ Views Premium (Parte 3 da spec): Calendário, Tabela e Dashboard.
 * Todas read-only, sempre atrás do verificarAcessoBoard.
 */
@Injectable()
export class KanbanViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: KanbanAcessoService,
  ) {}

  /**
   * Calendário: cards E itens de checklist com prazo dentro do mês.
   * `mes` = "YYYY-MM".
   */
  async calendario(user: AuthenticatedUser, boardId: string, query: CalendarioQueryDto) {
    const board = await this.acesso.verificarAcessoBoard(user, boardId);
    const [ano, mes] = query.mes.split('-').map(Number);
    const inicio = new Date(Date.UTC(ano, mes - 1, 1));
    const fim = new Date(Date.UTC(ano, mes, 1)); // exclusivo

    const [cards, itens] = await Promise.all([
      this.prisma.kanbanCard.findMany({
        where: {
          arquivado: false,
          dataEntrega: { gte: inicio, lt: fim },
          lista: { boardId: board.id, arquivada: false },
        },
        select: {
          id: true,
          titulo: true,
          dataEntrega: true,
          concluido: true,
          corCapa: true,
          lista: { select: { id: true, nome: true } },
          etiquetas: { include: { etiqueta: true } },
        },
        orderBy: { dataEntrega: 'asc' },
      }),
      this.prisma.kanbanChecklistItem.findMany({
        where: {
          dataEntrega: { gte: inicio, lt: fim },
          checklist: {
            card: { arquivado: false, lista: { boardId: board.id, arquivada: false } },
          },
        },
        select: {
          id: true,
          texto: true,
          concluido: true,
          dataEntrega: true,
          responsavel: USUARIO_RESUMO,
          checklist: { select: { card: { select: { id: true, titulo: true } } } },
        },
        orderBy: { dataEntrega: 'asc' },
      }),
    ]);
    return { cards, itensChecklist: itens };
  }

  /** Tabela: todos os cards ativos com tudo que as colunas precisam. */
  async tabela(user: AuthenticatedUser, boardId: string) {
    const board = await this.acesso.verificarAcessoBoard(user, boardId);
    return this.prisma.kanbanCard.findMany({
      where: { arquivado: false, lista: { boardId: board.id, arquivada: false } },
      include: {
        lista: { select: { id: true, nome: true, posicao: true } },
        etiquetas: { include: { etiqueta: true } },
        membros: { include: { usuario: USUARIO_RESUMO } },
        campoValores: { include: { campo: true } },
      },
      orderBy: [{ lista: { posicao: 'asc' } }, { posicao: 'asc' }],
    });
  }

  /** Dashboard: agregados por lista, membro, etiqueta e vencimento. */
  async dashboard(user: AuthenticatedUser, boardId: string) {
    const board = await this.acesso.verificarAcessoBoard(user, boardId);
    const cards = await this.prisma.kanbanCard.findMany({
      where: { arquivado: false, lista: { boardId: board.id, arquivada: false } },
      select: {
        concluido: true,
        dataEntrega: true,
        lista: { select: { id: true, nome: true, posicao: true } },
        membros: { include: { usuario: USUARIO_RESUMO } },
        etiquetas: { include: { etiqueta: true } },
      },
    });

    const porLista = new Map<string, { nome: string; posicao: number; total: number }>();
    const porMembro = new Map<string, { nome: string; total: number }>();
    const porEtiqueta = new Map<string, { nome: string | null; cor: string; total: number }>();
    let semMembro = 0;
    const vencimento = { vencidos: 0, proximos7dias: 0, semData: 0, concluidos: 0, noPrazo: 0 };
    const agora = Date.now();
    const em7dias = agora + 7 * 24 * 60 * 60 * 1000;

    for (const card of cards) {
      const l = porLista.get(card.lista.id) ?? {
        nome: card.lista.nome,
        posicao: card.lista.posicao,
        total: 0,
      };
      l.total += 1;
      porLista.set(card.lista.id, l);

      if (card.membros.length === 0) semMembro += 1;
      for (const m of card.membros) {
        const atual = porMembro.get(m.usuario.id) ?? { nome: m.usuario.nome, total: 0 };
        atual.total += 1;
        porMembro.set(m.usuario.id, atual);
      }
      for (const e of card.etiquetas) {
        const atual = porEtiqueta.get(e.etiqueta.id) ?? {
          nome: e.etiqueta.nome,
          cor: e.etiqueta.cor,
          total: 0,
        };
        atual.total += 1;
        porEtiqueta.set(e.etiqueta.id, atual);
      }

      if (card.concluido) vencimento.concluidos += 1;
      else if (!card.dataEntrega) vencimento.semData += 1;
      else {
        const prazo = card.dataEntrega.getTime();
        if (prazo < agora) vencimento.vencidos += 1;
        else if (prazo <= em7dias) vencimento.proximos7dias += 1;
        else vencimento.noPrazo += 1;
      }
    }

    return {
      totalCards: cards.length,
      porLista: [...porLista.values()].sort((a, b) => a.posicao - b.posicao),
      porMembro: [...porMembro.entries()]
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.total - a.total),
      semMembro,
      porEtiqueta: [...porEtiqueta.entries()]
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.total - a.total),
      vencimento,
    };
  }
}
