import { Injectable } from '@nestjs/common';
import type { KanbanEtiqueta } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ConflictException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import type { CreateEtiquetaDto, UpdateEtiquetaDto } from './kanban.dto';

@Injectable()
export class KanbanEtiquetasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: KanbanAcessoService,
    private readonly atividade: KanbanAtividadeService,
  ) {}

  async create(
    user: AuthenticatedUser,
    boardId: string,
    dto: CreateEtiquetaDto,
  ): Promise<KanbanEtiqueta> {
    const board = await this.acesso.verificarAcessoBoard(user, boardId);
    const etiqueta = await this.prisma.kanbanEtiqueta.create({
      data: { boardId: board.id, nome: dto.nome ?? null, cor: dto.cor },
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'etiqueta_criada',
      dados: { etiquetaId: etiqueta.id, nome: etiqueta.nome, cor: etiqueta.cor },
    });
    return etiqueta;
  }

  async update(
    user: AuthenticatedUser,
    etiquetaId: string,
    dto: UpdateEtiquetaDto,
  ): Promise<KanbanEtiqueta> {
    const board = await this.acesso.verificarAcessoPorEtiqueta(user, etiquetaId);
    const etiqueta = await this.prisma.kanbanEtiqueta.update({
      where: { id: etiquetaId },
      data: dto,
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'etiqueta_atualizada',
      dados: { etiquetaId, nome: etiqueta.nome, cor: etiqueta.cor },
    });
    return etiqueta;
  }

  async remove(user: AuthenticatedUser, etiquetaId: string): Promise<void> {
    const board = await this.acesso.verificarAcessoPorEtiqueta(user, etiquetaId);
    const etiqueta = await this.prisma.kanbanEtiqueta.delete({ where: { id: etiquetaId } });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'etiqueta_removida',
      dados: { nome: etiqueta.nome, cor: etiqueta.cor },
    });
  }

  /** Aplica etiqueta num card (etiqueta e card DEVEM ser do mesmo board). */
  async aplicarNoCard(user: AuthenticatedUser, cardId: string, etiquetaId: string) {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const etiqueta = await this.prisma.kanbanEtiqueta.findFirst({
      where: { id: etiquetaId, boardId: board.id },
    });
    if (!etiqueta) throw new NotFoundException('Etiqueta', etiquetaId);

    try {
      const vinculo = await this.prisma.kanbanCardEtiqueta.create({
        data: { cardId: card.id, etiquetaId },
        include: { etiqueta: true },
      });
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: 'card_etiquetado',
        cardId,
        dados: { etiquetaNome: etiqueta.nome, etiquetaCor: etiqueta.cor },
      });
      return vinculo;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        throw new ConflictException('Card já tem esta etiqueta');
      }
      throw err;
    }
  }

  async removerDoCard(user: AuthenticatedUser, cardId: string, etiquetaId: string): Promise<void> {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const removidos = await this.prisma.kanbanCardEtiqueta.deleteMany({
      where: { cardId: card.id, etiquetaId },
    });
    if (removidos.count === 0) throw new NotFoundException('Etiqueta no card', etiquetaId);
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'card_etiqueta_removida',
      cardId,
      dados: { etiquetaId },
    });
  }
}
