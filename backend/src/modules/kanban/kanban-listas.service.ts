import { Injectable } from '@nestjs/common';
import type { KanbanLista } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import { posicaoNoFim, precisaRebalancear, rebalancear } from './kanban-posicao.util';
import type { CreateListaDto, MoverListaDto, UpdateListaDto } from './kanban.dto';

@Injectable()
export class KanbanListasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: KanbanAcessoService,
    private readonly atividade: KanbanAtividadeService,
  ) {}

  /** Cria lista no fim do board. */
  async create(
    user: AuthenticatedUser,
    boardId: string,
    dto: CreateListaDto,
  ): Promise<KanbanLista> {
    const board = await this.acesso.verificarAcessoBoard(user, boardId);
    // Mesmo motivo do #18 no `mover`: ler a última posição e criar em passos
    // separados fazia duas listas criadas ao mesmo tempo nascerem na MESMA
    // posição (e a ordem virava sorteio a cada reload).
    const lista = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${board.id}))`;
      const ultima = await tx.kanbanLista.findFirst({
        where: { boardId: board.id },
        orderBy: { posicao: 'desc' },
        select: { posicao: true },
      });
      return tx.kanbanLista.create({
        data: { boardId: board.id, nome: dto.nome, posicao: posicaoNoFim(ultima?.posicao) },
      });
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'lista_criada',
      dados: { listaId: lista.id, nome: lista.nome },
    });
    return lista;
  }

  /** Renomear / arquivar / restaurar. */
  async update(
    user: AuthenticatedUser,
    listaId: string,
    dto: UpdateListaDto,
  ): Promise<KanbanLista> {
    const { board } = await this.acesso.verificarAcessoPorLista(user, listaId);
    const antes = await this.prisma.kanbanLista.findUniqueOrThrow({ where: { id: listaId } });
    const lista = await this.prisma.kanbanLista.update({ where: { id: listaId }, data: dto });

    if (dto.arquivada !== undefined && dto.arquivada !== antes.arquivada) {
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: dto.arquivada ? 'lista_arquivada' : 'lista_restaurada',
        dados: { listaId, nome: lista.nome },
      });
    }
    if (dto.nome && dto.nome !== antes.nome) {
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: 'lista_renomeada',
        dados: { listaId, de: antes.nome, para: dto.nome },
      });
    }
    return lista;
  }

  /**
   * Move a lista pra nova posição (Float vindo do front = média entre
   * vizinhos). Rebalanceia o board quando os gaps ficam < epsilon.
   */
  async mover(user: AuthenticatedUser, listaId: string, dto: MoverListaDto): Promise<KanbanLista> {
    const { board } = await this.acesso.verificarAcessoPorLista(user, listaId);

    // AUDITORIA (#18): o move gravava a posição, LIA as listas e rebalanceava em
    // outra transação. Duas pessoas arrastando listas do mesmo board ao mesmo
    // tempo liam o estado no meio do rebalanceamento da outra — o board voltava
    // com listas fora de ordem ou duas na mesma posição, e só um F5 + novo
    // arrasto consertava. Agora é uma transação só, serializada por board com
    // advisory lock (o lock cai sozinho no commit/rollback).
    const lista = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${board.id}))`;
      const movida = await tx.kanbanLista.update({
        where: { id: listaId },
        data: { posicao: dto.posicao },
      });

      // Rebalanceamento (mesma técnica do Trello) quando o espaço aperta
      const listas = await tx.kanbanLista.findMany({
        where: { boardId: board.id, arquivada: false },
        orderBy: { posicao: 'asc' },
        select: { id: true, posicao: true },
      });
      if (precisaRebalancear(listas.map((l) => l.posicao))) {
        for (const r of rebalancear(listas)) {
          await tx.kanbanLista.update({ where: { id: r.id }, data: { posicao: r.posicao } });
        }
      }
      return movida;
    });

    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'lista_movida',
      dados: { listaId, nome: lista.nome, posicao: dto.posicao },
    });
    return lista;
  }
}
