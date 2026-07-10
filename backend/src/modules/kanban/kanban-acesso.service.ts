import { Injectable } from '@nestjs/common';
import type { KanbanBoard } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

export interface AcessoBoardOpts {
  /** Exige que o usuário seja o dono do board (criador) — ou DIRECTOR/ADMIN. */
  exigirDono?: boolean;
  /** Permite acessar board arquivado (default: false → 404 em arquivado). */
  incluirArquivado?: boolean;
}

/**
 * Ponto ÚNICO de autorização do Kanban (regra da spec: usar em TUDO).
 *
 * Valida, nesta ordem:
 *  1. Board existe e pertence à empresa ATIVA do usuário (multi-tenant —
 *     board de outra empresa responde 404, não 403, pra não vazar existência).
 *  2. Usuário enxerga o board: criador OU membro OU DIRECTOR/ADMIN da empresa.
 *  3. (opcional) exigirDono: só criador/DIRECTOR/ADMIN — pra editar board,
 *     arquivar e gerenciar membros.
 */
@Injectable()
export class KanbanAcessoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Papéis que enxergam (e administram) todos os boards da empresa. */
  private isGestorEmpresa(user: AuthenticatedUser): boolean {
    return user.role === 'ADMIN' || user.role === 'DIRECTOR';
  }

  async verificarAcessoBoard(
    user: AuthenticatedUser,
    boardId: string,
    opts: AcessoBoardOpts = {},
  ): Promise<KanbanBoard> {
    const empresaId = getCallerEmpresaId(user);
    const board = await this.prisma.kanbanBoard.findFirst({
      where: { id: boardId, empresaId, ...(opts.incluirArquivado ? {} : { arquivado: false }) },
    });
    if (!board) throw new NotFoundException('Quadro', boardId);

    if (this.isGestorEmpresa(user)) return board;

    const ehDono = board.criadoPorId === user.id;
    if (opts.exigirDono) {
      if (!ehDono) {
        throw new ForbiddenException('Apenas o dono do quadro (ou diretor/admin) pode fazer isso');
      }
      return board;
    }

    if (ehDono) return board;
    const membro = await this.prisma.kanbanBoardMembro.count({
      where: { boardId: board.id, usuarioId: user.id },
    });
    if (membro === 0) {
      throw new ForbiddenException('Você não participa deste quadro');
    }
    return board;
  }

  /**
   * Resolve o board a partir de uma LISTA e valida acesso (atalho pros
   * endpoints /kanban/listas/:id — a lista não carrega empresaId própria).
   */
  async verificarAcessoPorLista(
    user: AuthenticatedUser,
    listaId: string,
    opts: AcessoBoardOpts = {},
  ): Promise<{ board: KanbanBoard; listaBoardId: string }> {
    const lista = await this.prisma.kanbanLista.findUnique({
      where: { id: listaId },
      select: { boardId: true },
    });
    if (!lista) throw new NotFoundException('Lista', listaId);
    const board = await this.verificarAcessoBoard(user, lista.boardId, opts);
    return { board, listaBoardId: lista.boardId };
  }

  /**
   * Resolve o board a partir de um CARD (card → lista → board) e valida
   * acesso. Card arquivado continua acessível (modal de restaurar).
   */
  async verificarAcessoPorCard(
    user: AuthenticatedUser,
    cardId: string,
    opts: AcessoBoardOpts = {},
  ): Promise<{ board: KanbanBoard; card: { id: string; listaId: string; listaNome: string } }> {
    const card = await this.prisma.kanbanCard.findUnique({
      where: { id: cardId },
      select: { id: true, listaId: true, lista: { select: { boardId: true, nome: true } } },
    });
    if (!card) throw new NotFoundException('Card', cardId);
    const board = await this.verificarAcessoBoard(user, card.lista.boardId, opts);
    return { board, card: { id: card.id, listaId: card.listaId, listaNome: card.lista.nome } };
  }

  /** Etiqueta → board. */
  async verificarAcessoPorEtiqueta(
    user: AuthenticatedUser,
    etiquetaId: string,
    opts: AcessoBoardOpts = {},
  ): Promise<KanbanBoard> {
    const etiqueta = await this.prisma.kanbanEtiqueta.findUnique({
      where: { id: etiquetaId },
      select: { boardId: true },
    });
    if (!etiqueta) throw new NotFoundException('Etiqueta', etiquetaId);
    return this.verificarAcessoBoard(user, etiqueta.boardId, opts);
  }

  /** Checklist → card → lista → board. */
  async verificarAcessoPorChecklist(
    user: AuthenticatedUser,
    checklistId: string,
    opts: AcessoBoardOpts = {},
  ): Promise<{ board: KanbanBoard; cardId: string }> {
    const checklist = await this.prisma.kanbanChecklist.findUnique({
      where: { id: checklistId },
      select: { cardId: true, card: { select: { lista: { select: { boardId: true } } } } },
    });
    if (!checklist) throw new NotFoundException('Checklist', checklistId);
    const board = await this.verificarAcessoBoard(user, checklist.card.lista.boardId, opts);
    return { board, cardId: checklist.cardId };
  }

  /** Item de checklist → checklist → card → board. */
  async verificarAcessoPorChecklistItem(
    user: AuthenticatedUser,
    itemId: string,
    opts: AcessoBoardOpts = {},
  ): Promise<{ board: KanbanBoard; cardId: string; checklistId: string }> {
    const item = await this.prisma.kanbanChecklistItem.findUnique({
      where: { id: itemId },
      select: {
        checklistId: true,
        checklist: {
          select: { cardId: true, card: { select: { lista: { select: { boardId: true } } } } },
        },
      },
    });
    if (!item) throw new NotFoundException('Item de checklist', itemId);
    const board = await this.verificarAcessoBoard(user, item.checklist.card.lista.boardId, opts);
    return { board, cardId: item.checklist.cardId, checklistId: item.checklistId };
  }

  /** Campo personalizado → board. */
  async verificarAcessoPorCampo(
    user: AuthenticatedUser,
    campoId: string,
    opts: AcessoBoardOpts = {},
  ): Promise<KanbanBoard> {
    const campo = await this.prisma.kanbanCampoPersonalizado.findUnique({
      where: { id: campoId },
      select: { boardId: true },
    });
    if (!campo) throw new NotFoundException('Campo personalizado', campoId);
    return this.verificarAcessoBoard(user, campo.boardId, opts);
  }

  /**
   * Garante que o usuário é MEMBRO do board (usado pra atribuir card e
   * delegar item de checklist — regra da spec: responsável precisa ser
   * membro do board). O criador sempre tem linha "dono" em membros.
   */
  async exigirMembroDoBoard(boardId: string, usuarioId: string, contexto: string): Promise<void> {
    const membro = await this.prisma.kanbanBoardMembro.count({
      where: { boardId, usuarioId },
    });
    if (membro === 0) {
      throw new BusinessRuleException(`${contexto} precisa ser membro do quadro`);
    }
  }
}
