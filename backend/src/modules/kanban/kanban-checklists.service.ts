import { Injectable } from '@nestjs/common';
import type { KanbanChecklist, KanbanChecklistItem } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import { USUARIO_RESUMO } from './kanban.constants';
import { POSICAO_GAP, posicaoNoFim } from './kanban-posicao.util';
import type {
  CreateChecklistDto,
  CreateChecklistItemDto,
  MeusItensQueryDto,
  UpdateChecklistDto,
  UpdateChecklistItemDto,
} from './kanban.dto';

@Injectable()
export class KanbanChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: KanbanAcessoService,
    private readonly atividade: KanbanAtividadeService,
  ) {}

  /**
   * Cria checklist no card, opcionalmente já com itens (usado pelo MCP:
   * kanban_criar_checklist manda itens[] com prazo/responsável ★).
   */
  async create(user: AuthenticatedUser, cardId: string, dto: CreateChecklistDto) {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);

    // Todo responsável indicado precisa ser membro do board (regra ★)
    for (const item of dto.itens ?? []) {
      if (item.responsavelId) {
        await this.acesso.exigirMembroDoBoard(board.id, item.responsavelId, 'Responsável');
      }
    }

    const ultimo = await this.prisma.kanbanChecklist.findFirst({
      where: { cardId: card.id },
      orderBy: { posicao: 'desc' },
      select: { posicao: true },
    });
    const checklist = await this.prisma.kanbanChecklist.create({
      data: {
        cardId: card.id,
        titulo: dto.titulo,
        posicao: posicaoNoFim(ultimo?.posicao),
        itens: dto.itens?.length
          ? {
              create: dto.itens.map((item, i) => ({
                texto: item.texto,
                dataEntrega: item.dataEntrega ?? null,
                responsavelId: item.responsavelId ?? null,
                posicao: (i + 1) * POSICAO_GAP,
              })),
            }
          : undefined,
      },
      include: {
        itens: { orderBy: { posicao: 'asc' }, include: { responsavel: USUARIO_RESUMO } },
      },
    });

    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'checklist_criado',
      cardId: card.id,
      dados: { titulo: checklist.titulo, itens: checklist.itens.length },
    });
    for (const item of checklist.itens) {
      if (item.responsavelId) {
        await this.registrarDelegacao(board.id, card.id, user.id, item);
      }
    }
    return checklist;
  }

  async update(
    user: AuthenticatedUser,
    checklistId: string,
    dto: UpdateChecklistDto,
  ): Promise<KanbanChecklist> {
    const { board, cardId } = await this.acesso.verificarAcessoPorChecklist(user, checklistId);
    const checklist = await this.prisma.kanbanChecklist.update({
      where: { id: checklistId },
      data: dto,
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'checklist_atualizado',
      cardId,
      dados: { checklistId, campos: Object.keys(dto) },
    });
    return checklist;
  }

  async remove(user: AuthenticatedUser, checklistId: string): Promise<void> {
    const { board, cardId } = await this.acesso.verificarAcessoPorChecklist(user, checklistId);
    const checklist = await this.prisma.kanbanChecklist.delete({ where: { id: checklistId } });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'checklist_removido',
      cardId,
      dados: { titulo: checklist.titulo },
    });
  }

  // ─── Itens ──────────────────────────────────────────────────────────

  async createItem(user: AuthenticatedUser, checklistId: string, dto: CreateChecklistItemDto) {
    const { board, cardId } = await this.acesso.verificarAcessoPorChecklist(user, checklistId);
    if (dto.responsavelId) {
      await this.acesso.exigirMembroDoBoard(board.id, dto.responsavelId, 'Responsável');
    }

    const ultimo = await this.prisma.kanbanChecklistItem.findFirst({
      where: { checklistId },
      orderBy: { posicao: 'desc' },
      select: { posicao: true },
    });
    const item = await this.prisma.kanbanChecklistItem.create({
      data: {
        checklistId,
        texto: dto.texto,
        dataEntrega: dto.dataEntrega ?? null,
        responsavelId: dto.responsavelId ?? null,
        posicao: posicaoNoFim(ultimo?.posicao),
      },
      include: { responsavel: USUARIO_RESUMO },
    });

    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'checklist_item_criado',
      cardId,
      dados: { texto: item.texto },
    });
    if (item.responsavelId) {
      await this.registrarDelegacao(board.id, cardId, user.id, item);
    }
    return item;
  }

  /** Texto, concluído, posição, prazo ★ e responsável ★ por item. */
  async updateItem(user: AuthenticatedUser, itemId: string, dto: UpdateChecklistItemDto) {
    const { board, cardId } = await this.acesso.verificarAcessoPorChecklistItem(user, itemId);
    if (dto.responsavelId) {
      await this.acesso.exigirMembroDoBoard(board.id, dto.responsavelId, 'Responsável');
    }

    const antes = await this.prisma.kanbanChecklistItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    const item = await this.prisma.kanbanChecklistItem.update({
      where: { id: itemId },
      data: dto,
      include: { responsavel: USUARIO_RESUMO },
    });

    if (dto.concluido !== undefined && dto.concluido !== antes.concluido) {
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: dto.concluido ? 'checklist_item_concluido' : 'checklist_item_reaberto',
        cardId,
        dados: { texto: item.texto },
      });
    }
    if (dto.responsavelId !== undefined && dto.responsavelId !== antes.responsavelId) {
      if (item.responsavelId) {
        await this.registrarDelegacao(board.id, cardId, user.id, item);
      } else {
        await this.atividade.registrar({
          boardId: board.id,
          usuarioId: user.id,
          tipo: 'item_delegacao_removida',
          cardId,
          dados: { texto: item.texto },
        });
      }
    }
    return item;
  }

  async removeItem(user: AuthenticatedUser, itemId: string): Promise<void> {
    const { board, cardId } = await this.acesso.verificarAcessoPorChecklistItem(user, itemId);
    const item = await this.prisma.kanbanChecklistItem.delete({ where: { id: itemId } });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'checklist_item_removido',
      cardId,
      dados: { texto: item.texto },
    });
  }

  /**
   * ★ "Meus itens": todos os itens de checklist delegados ao usuário logado,
   * em todos os boards da empresa ativa, ordenados por prazo (sem prazo por
   * último). Ignora cards/listas/boards arquivados.
   */
  async meusItens(user: AuthenticatedUser, query: MeusItensQueryDto) {
    const empresaId = getCallerEmpresaId(user);
    return this.prisma.kanbanChecklistItem.findMany({
      where: {
        responsavelId: user.id,
        ...(query.incluirConcluidos ? {} : { concluido: false }),
        checklist: {
          card: {
            arquivado: false,
            lista: {
              arquivada: false,
              board: {
                empresaId,
                arquivado: false,
                // Ex-membro do board não vê mais itens delegados a ele:
                // exige ser criador OU membro atual do board.
                OR: [{ criadoPorId: user.id }, { membros: { some: { usuarioId: user.id } } }],
              },
            },
          },
        },
      },
      orderBy: [{ dataEntrega: { sort: 'asc', nulls: 'last' } }, { posicao: 'asc' }],
      include: {
        checklist: {
          select: {
            id: true,
            titulo: true,
            card: {
              select: {
                id: true,
                titulo: true,
                lista: {
                  select: {
                    nome: true,
                    board: { select: { id: true, nome: true, corFundo: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  private async registrarDelegacao(
    boardId: string,
    cardId: string,
    autorId: string,
    item: KanbanChecklistItem & { responsavel?: { nome: string } | null },
  ): Promise<void> {
    await this.atividade.registrar({
      boardId,
      usuarioId: autorId,
      tipo: 'item_delegado',
      cardId,
      dados: {
        texto: item.texto,
        responsavelId: item.responsavelId,
        responsavelNome: item.responsavel?.nome ?? null,
        dataEntrega: item.dataEntrega?.toISOString() ?? null,
      },
    });
  }
}
