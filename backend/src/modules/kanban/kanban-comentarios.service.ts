import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import { USUARIO_RESUMO } from './kanban.constants';
import type { CreateComentarioDto } from './kanban.dto';

@Injectable()
export class KanbanComentariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: KanbanAcessoService,
    private readonly atividade: KanbanAtividadeService,
  ) {}

  async create(user: AuthenticatedUser, cardId: string, dto: CreateComentarioDto) {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const comentario = await this.prisma.kanbanComentario.create({
      data: { cardId: card.id, autorId: user.id, texto: dto.texto },
      include: { autor: USUARIO_RESUMO },
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'comentario',
      cardId,
      dados: { texto: dto.texto.slice(0, 200) },
    });
    return comentario;
  }

  /** Deletar: SÓ o autor ou ADMIN (regra da spec). */
  async remove(user: AuthenticatedUser, comentarioId: string): Promise<void> {
    const comentario = await this.prisma.kanbanComentario.findUnique({
      where: { id: comentarioId },
      select: { id: true, autorId: true, cardId: true },
    });
    if (!comentario) throw new NotFoundException('Comentário', comentarioId);

    // Acesso ao board primeiro (multi-tenant), depois a regra de autoria
    const { board } = await this.acesso.verificarAcessoPorCard(user, comentario.cardId);
    if (comentario.autorId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas o autor do comentário (ou admin) pode excluí-lo');
    }

    await this.prisma.kanbanComentario.delete({ where: { id: comentarioId } });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'comentario_removido',
      cardId: comentario.cardId,
      dados: {},
    });
  }
}
