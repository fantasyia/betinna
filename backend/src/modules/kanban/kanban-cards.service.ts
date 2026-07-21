import { Injectable, Logger } from '@nestjs/common';
import type { KanbanCard } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ConflictException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAnexosService } from './kanban-anexos.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import { KanbanTarefaService } from './kanban-tarefa.service';
import { CARD_ATIVIDADES_LIMIT, USUARIO_RESUMO } from './kanban.constants';
import { posicaoNoFim, precisaRebalancear, rebalancear } from './kanban-posicao.util';
import type { CreateCardDto, MoverCardDto, UpdateCardDto } from './kanban.dto';

@Injectable()
export class KanbanCardsService {
  private readonly logger = new Logger(KanbanCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: KanbanAcessoService,
    private readonly atividade: KanbanAtividadeService,
    private readonly tarefa: KanbanTarefaService,
    private readonly anexos: KanbanAnexosService,
  ) {}

  /**
   * Propaga a alteração pra contraparte espelhada (Diretor↔rep — mesmo card),
   * nos dois sentidos. Best-effort: falha na sincronia NÃO pode derrubar a
   * operação do usuário no card.
   */
  private async sincronizarEspelho(cardId: string): Promise<void> {
    try {
      await this.tarefa.sincronizarContraparte(cardId);
    } catch (err) {
      this.logger.warn(`Falha ao sincronizar espelho do card ${cardId}: ${String(err)}`);
    }
  }

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

  /**
   * Duplica um card na MESMA lista (logo após o original): copia título (+ " (cópia)"),
   * descrição, capa, datas, etiquetas, membros e checklists com seus itens.
   * Não copia comentários/anexos/atividade (histórico é do card original).
   */
  async duplicar(user: AuthenticatedUser, cardId: string): Promise<KanbanCard> {
    const { board } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const original = await this.prisma.kanbanCard.findUniqueOrThrow({
      where: { id: cardId },
      include: {
        lista: { select: { nome: true } },
        etiquetas: { select: { etiquetaId: true } },
        membros: { select: { usuarioId: true } },
        checklists: {
          orderBy: { posicao: 'asc' },
          include: { itens: { orderBy: { posicao: 'asc' } } },
        },
      },
    });

    const ultimo = await this.prisma.kanbanCard.findFirst({
      where: { listaId: original.listaId },
      orderBy: { posicao: 'desc' },
      select: { posicao: true },
    });

    const novo = await this.prisma.kanbanCard.create({
      data: {
        listaId: original.listaId,
        titulo: `${original.titulo} (cópia)`,
        descricao: original.descricao,
        corCapa: original.corCapa,
        dataInicio: original.dataInicio,
        dataEntrega: original.dataEntrega,
        posicao: posicaoNoFim(ultimo?.posicao),
        etiquetas: { create: original.etiquetas.map((e) => ({ etiquetaId: e.etiquetaId })) },
        membros: { create: original.membros.map((m) => ({ usuarioId: m.usuarioId })) },
        checklists: {
          create: original.checklists.map((cl) => ({
            titulo: cl.titulo,
            posicao: cl.posicao,
            itens: {
              create: cl.itens.map((it) => ({
                texto: it.texto,
                posicao: it.posicao,
                concluido: it.concluido,
                dataEntrega: it.dataEntrega,
                responsavelId: it.responsavelId,
              })),
            },
          })),
        },
      },
    });

    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'card_criado',
      cardId: novo.id,
      dados: { titulo: novo.titulo, listaNome: original.lista.nome },
    });
    return novo;
  }

  /** Card completo: checklists, comentários, anexos, etiquetas, membros e atividade. */
  async findById(user: AuthenticatedUser, cardId: string) {
    const { canonicoId } = await this.acesso.verificarAcessoPorCard(user, cardId);
    // Grupo de espelho: relações compartilhadas (checklists/comentários/anexos/
    // membros) moram no card canônico; etiquetas/campos/coluna são do card próprio.
    const grupo = await this.acesso.cardsDoGrupo(cardId);

    const [card, compartilhado, atividades] = await Promise.all([
      this.prisma.kanbanCard.findUniqueOrThrow({
        where: { id: cardId },
        include: {
          lista: { select: { id: true, nome: true, boardId: true } },
          etiquetas: { include: { etiqueta: true } },
          campoValores: { include: { campo: true } },
        },
      }),
      this.prisma.kanbanCard.findUniqueOrThrow({
        where: { id: canonicoId },
        select: {
          membros: { include: { usuario: USUARIO_RESUMO } },
          checklists: {
            orderBy: { posicao: 'asc' },
            include: {
              itens: { orderBy: { posicao: 'asc' }, include: { responsavel: USUARIO_RESUMO } },
            },
          },
          comentarios: { orderBy: { criadoEm: 'desc' }, include: { autor: USUARIO_RESUMO } },
          anexos: { orderBy: { criadoEm: 'desc' } },
        },
      }),
      this.prisma.kanbanAtividade.findMany({
        where: { cardId: { in: grupo } },
        orderBy: { criadoEm: 'desc' },
        take: CARD_ATIVIDADES_LIMIT,
        include: { usuario: USUARIO_RESUMO },
      }),
    ]);
    return { ...card, ...compartilhado, atividades };
  }

  /** Título, descrição, datas, concluído, capa, arquivar/restaurar. */
  /**
   * EXCLUI o card de vez (não é arquivar). Cascade do banco leva junto
   * checklists+itens, comentários, anexos, etiquetas, membros e campos.
   *
   * ⚠️ ESPELHO: a FK `origemCardId` é ON DELETE CASCADE — excluir o card ORIGEM
   * apaga os ESPELHOS dele (é o mesmo card nos dois quadros; deixar espelho órfão
   * seria pior). Excluir um espelho não mexe na origem. O nº de espelhos removidos
   * volta na resposta pra quem chamou não ser pego de surpresa.
   *
   * A atividade é registrada ANTES do delete (KanbanAtividade.cardId não tem FK,
   * então o rastro sobrevive à exclusão) e os arquivos saem do storage antes —
   * senão ficariam órfãos no bucket.
   */
  async remover(
    user: AuthenticatedUser,
    cardId: string,
  ): Promise<{ ok: true; titulo: string; espelhosRemovidos: number; arquivosRemovidos: number }> {
    const { board } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const card = await this.prisma.kanbanCard.findUniqueOrThrow({
      where: { id: cardId },
      select: { id: true, titulo: true, espelhos: { select: { id: true } } },
    });
    const espelhoIds = card.espelhos.map((e) => e.id);

    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'card_excluido',
      cardId,
      dados: { titulo: card.titulo, espelhosRemovidos: espelhoIds.length },
    });

    const arquivosRemovidos = await this.anexos.purgarArquivosDosCards([cardId, ...espelhoIds]);
    await this.prisma.kanbanCard.delete({ where: { id: cardId } });
    this.logger.log(
      `Card excluído: ${cardId} "${card.titulo}" (board ${board.id}, ${espelhoIds.length} espelho(s))`,
    );
    return {
      ok: true,
      titulo: card.titulo,
      espelhosRemovidos: espelhoIds.length,
      arquivosRemovidos,
    };
  }

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
    // Espelho reflete qualquer ajuste do card na contraparte (título, descrição,
    // datas, capa, concluído, arquivado). É o mesmo card nos dois quadros.
    await this.sincronizarEspelho(cardId);
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
    await this.sincronizarEspelho(cardId);
    return movido;
  }

  // ─── Membros do card ────────────────────────────────────────────────

  /** Atribui membro ao card (precisa ser membro do board, igual Trello). */
  async addMembro(user: AuthenticatedUser, cardId: string, usuarioId: string) {
    const { board, canonicoId } = await this.acesso.verificarAcessoPorCard(user, cardId);
    await this.acesso.exigirMembroDoBoard(board.id, usuarioId, 'Membro do card');

    try {
      // Membro mora no card CANÔNICO (compartilhado pelo par de espelho).
      const membro = await this.prisma.kanbanCardMembro.create({
        data: { cardId: canonicoId, usuarioId },
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
    const { board, canonicoId } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const removidos = await this.prisma.kanbanCardMembro.deleteMany({
      where: { cardId: canonicoId, usuarioId },
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
