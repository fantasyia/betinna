import { Injectable } from '@nestjs/common';
import type { KanbanCard } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ConflictException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import { CARD_ATIVIDADES_LIMIT, USUARIO_RESUMO } from './kanban.constants';
import { posicaoNoFim, precisaRebalancear, rebalancear } from './kanban-posicao.util';
import type { CreateCardDto, MoverCardDto, UpdateCardDto } from './kanban.dto';

@Injectable()
export class KanbanCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: KanbanAcessoService,
    private readonly atividade: KanbanAtividadeService,
  ) {}

  /** Cria card no fim da lista. */
  async create(user: AuthenticatedUser, listaId: string, dto: CreateCardDto): Promise<KanbanCard> {
    const { board } = await this.acesso.verificarAcessoPorLista(user, listaId);
    const lista = await this.prisma.kanbanLista.findUniqueOrThrow({
      where: { id: listaId },
      select: { nome: true, arquivada: true },
    });
    if (lista.arquivada) {
      throw new BusinessRuleException('Não é possível criar card em lista arquivada');
    }

    const ultimo = await this.prisma.kanbanCard.findFirst({
      where: { listaId },
      orderBy: { posicao: 'desc' },
      select: { posicao: true },
    });
    const card = await this.prisma.kanbanCard.create({
      data: {
        listaId,
        titulo: dto.titulo,
        descricao: dto.descricao,
        dataInicio: dto.dataInicio ?? null,
        dataEntrega: dto.dataEntrega ?? null,
        posicao: posicaoNoFim(ultimo?.posicao),
      },
    });

    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'card_criado',
      cardId: card.id,
      dados: { titulo: card.titulo, listaNome: lista.nome },
    });
    return card;
  }

  /** Card completo: checklists, comentários, anexos, etiquetas, membros e atividade. */
  async findById(user: AuthenticatedUser, cardId: string) {
    await this.acesso.verificarAcessoPorCard(user, cardId);

    const [card, atividades] = await Promise.all([
      this.prisma.kanbanCard.findUniqueOrThrow({
        where: { id: cardId },
        include: {
          lista: { select: { id: true, nome: true, boardId: true } },
          etiquetas: { include: { etiqueta: true } },
          membros: { include: { usuario: USUARIO_RESUMO } },
          checklists: {
            orderBy: { posicao: 'asc' },
            include: {
              itens: { orderBy: { posicao: 'asc' }, include: { responsavel: USUARIO_RESUMO } },
            },
          },
          comentarios: { orderBy: { criadoEm: 'desc' }, include: { autor: USUARIO_RESUMO } },
          anexos: { orderBy: { criadoEm: 'desc' } },
          campoValores: { include: { campo: true } },
        },
      }),
      this.prisma.kanbanAtividade.findMany({
        where: { cardId },
        orderBy: { criadoEm: 'desc' },
        take: CARD_ATIVIDADES_LIMIT,
        include: { usuario: USUARIO_RESUMO },
      }),
    ]);
    return { ...card, atividades };
  }

  /** Título, descrição, datas, concluído, capa, arquivar/restaurar. */
  async update(user: AuthenticatedUser, cardId: string, dto: UpdateCardDto): Promise<KanbanCard> {
    const { board } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const antes = await this.prisma.kanbanCard.findUniqueOrThrow({ where: { id: cardId } });
    const card = await this.prisma.kanbanCard.update({ where: { id: cardId }, data: dto });

    // Atividades específicas pros eventos que importam no feed
    if (dto.concluido !== undefined && dto.concluido !== antes.concluido) {
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: dto.concluido ? 'card_concluido' : 'card_reaberto',
        cardId,
        dados: { titulo: card.titulo },
      });
    }
    if (dto.arquivado !== undefined && dto.arquivado !== antes.arquivado) {
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: dto.arquivado ? 'card_arquivado' : 'card_restaurado',
        cardId,
        dados: { titulo: card.titulo },
      });
    }
    const outrosCampos = Object.keys(dto).filter((k) => k !== 'concluido' && k !== 'arquivado');
    if (outrosCampos.length > 0) {
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: 'card_atualizado',
        cardId,
        dados: { titulo: card.titulo, campos: outrosCampos },
      });
    }
    return card;
  }

  /**
   * O coração do drag & drop: move card pra outra lista/posição.
   * Posição Float = média entre vizinhos (calculada no front); rebalanceia
   * a lista destino quando os gaps ficam < epsilon (Parte 1 da spec).
   */
  async mover(user: AuthenticatedUser, cardId: string, dto: MoverCardDto): Promise<KanbanCard> {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);

    // Lista destino DEVE ser do mesmo board (senão daria pra "teleportar"
    // card pra quadro de outro time/empresa)
    const destino = await this.prisma.kanbanLista.findFirst({
      where: { id: dto.listaId, boardId: board.id },
      select: { id: true, nome: true, arquivada: true },
    });
    if (!destino) throw new NotFoundException('Lista', dto.listaId);
    if (destino.arquivada) {
      throw new BusinessRuleException('Não é possível mover card para lista arquivada');
    }

    const movido = await this.prisma.kanbanCard.update({
      where: { id: cardId },
      data: { listaId: destino.id, posicao: dto.posicao },
    });

    // Rebalanceamento da lista destino (mesma técnica do Trello)
    const cards = await this.prisma.kanbanCard.findMany({
      where: { listaId: destino.id, arquivado: false },
      orderBy: { posicao: 'asc' },
      select: { id: true, posicao: true },
    });
    if (precisaRebalancear(cards.map((c) => c.posicao))) {
      await this.prisma.$transaction(
        rebalancear(cards).map((r) =>
          this.prisma.kanbanCard.update({ where: { id: r.id }, data: { posicao: r.posicao } }),
        ),
      );
    }

    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'card_movido',
      cardId,
      dados: { titulo: movido.titulo, deListaNome: card.listaNome, paraListaNome: destino.nome },
    });
    return movido;
  }

  // ─── Membros do card ────────────────────────────────────────────────

  /** Atribui membro ao card (precisa ser membro do board, igual Trello). */
  async addMembro(user: AuthenticatedUser, cardId: string, usuarioId: string) {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);
    await this.acesso.exigirMembroDoBoard(board.id, usuarioId, 'Membro do card');

    try {
      const membro = await this.prisma.kanbanCardMembro.create({
        data: { cardId: card.id, usuarioId },
        include: { usuario: USUARIO_RESUMO },
      });
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: 'card_membro_adicionado',
        cardId,
        dados: { membroId: usuarioId, membroNome: membro.usuario.nome },
      });
      return membro;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        throw new ConflictException('Usuário já está atribuído a este card');
      }
      throw err;
    }
  }

  async removeMembro(user: AuthenticatedUser, cardId: string, usuarioId: string): Promise<void> {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const removidos = await this.prisma.kanbanCardMembro.deleteMany({
      where: { cardId: card.id, usuarioId },
    });
    if (removidos.count === 0) throw new NotFoundException('Membro do card', usuarioId);
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'card_membro_removido',
      cardId,
      dados: { membroId: usuarioId },
    });
  }
}
