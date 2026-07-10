import { Injectable } from '@nestjs/common';
import type { KanbanBoard, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import { USUARIO_RESUMO } from './kanban.constants';
import type {
  AddBoardMembroDto,
  AtividadesQueryDto,
  BuscaQueryDto,
  CreateBoardDto,
  UpdateBoardDto,
} from './kanban.dto';

@Injectable()
export class KanbanBoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: KanbanAcessoService,
    private readonly atividade: KanbanAtividadeService,
  ) {}

  /**
   * Meus boards. DIRECTOR/ADMIN: todos da empresa ativa.
   * Demais papéis: onde sou criador OU membro.
   */
  async list(user: AuthenticatedUser): Promise<KanbanBoard[]> {
    const empresaId = getCallerEmpresaId(user);
    const veTodos = user.role === 'ADMIN' || user.role === 'DIRECTOR';
    return this.prisma.kanbanBoard.findMany({
      where: {
        empresaId,
        arquivado: false,
        ...(veTodos
          ? {}
          : {
              OR: [{ criadoPorId: user.id }, { membros: { some: { usuarioId: user.id } } }],
            }),
      },
      include: {
        criadoPor: USUARIO_RESUMO,
        membros: { include: { usuario: USUARIO_RESUMO } },
        _count: { select: { listas: { where: { arquivada: false } } } },
      },
      orderBy: { atualizadoEm: 'desc' },
    });
  }

  /**
   * Cria board. REGRA DURA: representante pode ter no máximo 1 board
   * não-arquivado (validado AQUI no service, não só no frontend).
   * O criador vira membro papel "dono".
   */
  async create(user: AuthenticatedUser, dto: CreateBoardDto): Promise<KanbanBoard> {
    const empresaId = getCallerEmpresaId(user);

    if (user.role === 'REP') {
      const existentes = await this.prisma.kanbanBoard.count({
        where: { empresaId, criadoPorId: user.id, arquivado: false },
      });
      if (existentes >= 1) {
        throw new ForbiddenException(
          'Representante pode ter apenas 1 quadro. Arquive o quadro atual para criar outro.',
        );
      }
    }

    const board = await this.prisma.kanbanBoard.create({
      data: {
        nome: dto.nome,
        descricao: dto.descricao,
        corFundo: dto.corFundo,
        empresaId,
        criadoPorId: user.id,
        membros: { create: { usuarioId: user.id, papel: 'dono' } },
      },
      include: { membros: { include: { usuario: USUARIO_RESUMO } } },
    });

    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'board_criado',
      dados: { nome: board.nome },
    });
    return board;
  }

  /** Board completo: listas ativas (com cards resumidos), etiquetas, membros. */
  async findById(user: AuthenticatedUser, id: string) {
    await this.acesso.verificarAcessoBoard(user, id);
    return this.prisma.kanbanBoard.findUniqueOrThrow({
      where: { id },
      include: {
        criadoPor: USUARIO_RESUMO,
        membros: { include: { usuario: USUARIO_RESUMO } },
        etiquetas: true,
        campos: true,
        listas: {
          where: { arquivada: false },
          orderBy: { posicao: 'asc' },
          include: {
            cards: {
              where: { arquivado: false },
              orderBy: { posicao: 'asc' },
              include: {
                etiquetas: { include: { etiqueta: true } },
                membros: { include: { usuario: USUARIO_RESUMO } },
                // Só o necessário pros badges (contador X/Y do checklist)
                checklists: { select: { itens: { select: { concluido: true } } } },
                _count: { select: { comentarios: true, anexos: true } },
              },
            },
          },
        },
      },
    });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateBoardDto): Promise<KanbanBoard> {
    const board = await this.acesso.verificarAcessoBoard(user, id, { exigirDono: true });
    const atualizado = await this.prisma.kanbanBoard.update({
      where: { id: board.id },
      data: dto,
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'board_atualizado',
      dados: { campos: Object.keys(dto) },
    });
    return atualizado;
  }

  /** DELETE = arquivar (soft delete), padrão Trello. */
  async archive(user: AuthenticatedUser, id: string): Promise<void> {
    const board = await this.acesso.verificarAcessoBoard(user, id, { exigirDono: true });
    await this.prisma.kanbanBoard.update({ where: { id: board.id }, data: { arquivado: true } });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'board_arquivado',
      dados: { nome: board.nome },
    });
  }

  /** Convida membro — SEMPRE da mesma empresa do board (regra da spec). */
  async addMembro(user: AuthenticatedUser, boardId: string, dto: AddBoardMembroDto) {
    const board = await this.acesso.verificarAcessoBoard(user, boardId, { exigirDono: true });

    const vinculo = await this.prisma.usuarioEmpresa.findFirst({
      where: { usuarioId: dto.usuarioId, empresaId: board.empresaId },
      include: { usuario: USUARIO_RESUMO },
    });
    if (!vinculo) {
      throw new BusinessRuleException('Usuário não pertence à empresa deste quadro');
    }

    try {
      const membro = await this.prisma.kanbanBoardMembro.create({
        data: { boardId: board.id, usuarioId: dto.usuarioId },
        include: { usuario: USUARIO_RESUMO },
      });
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: 'membro_adicionado',
        dados: { membroId: dto.usuarioId, membroNome: vinculo.usuario.nome },
      });
      return membro;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        throw new ConflictException('Usuário já é membro deste quadro');
      }
      throw err;
    }
  }

  async removeMembro(user: AuthenticatedUser, boardId: string, usuarioId: string): Promise<void> {
    const board = await this.acesso.verificarAcessoBoard(user, boardId, { exigirDono: true });
    if (usuarioId === board.criadoPorId) {
      throw new BusinessRuleException('O dono do quadro não pode ser removido');
    }
    const removidos = await this.prisma.kanbanBoardMembro.deleteMany({
      where: { boardId: board.id, usuarioId },
    });
    if (removidos.count === 0) throw new NotFoundException('Membro', usuarioId);
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'membro_removido',
      dados: { membroId: usuarioId },
    });
  }

  // ─── Atividade e busca ──────────────────────────────────────────────

  /** Feed do board (é o que alimenta o painel de acompanhamento + polling). */
  async atividades(user: AuthenticatedUser, boardId: string, query: AtividadesQueryDto) {
    const board = await this.acesso.verificarAcessoBoard(user, boardId, {
      incluirArquivado: true,
    });
    return this.prisma.kanbanAtividade.findMany({
      where: { boardId: board.id, ...(query.antes ? { criadoEm: { lt: query.antes } } : {}) },
      orderBy: { criadoEm: 'desc' },
      take: query.limit,
      include: { usuario: USUARIO_RESUMO },
    });
  }

  /** Busca cards do board: texto (título/descrição), etiqueta, membro, vencimento. */
  async busca(user: AuthenticatedUser, boardId: string, query: BuscaQueryDto) {
    const board = await this.acesso.verificarAcessoBoard(user, boardId);

    const where: Prisma.KanbanCardWhereInput = {
      arquivado: false,
      lista: { boardId: board.id, arquivada: false },
    };
    if (query.q) {
      where.OR = [
        { titulo: { contains: query.q, mode: 'insensitive' } },
        { descricao: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.etiqueta) {
      where.etiquetas = { some: { etiquetaId: query.etiqueta } };
    }
    if (query.membro) {
      where.membros = { some: { usuarioId: query.membro } };
    }
    if (query.vencimento === 'vencidos') {
      where.dataEntrega = { lt: new Date() };
      where.concluido = false;
    } else if (query.vencimento === 'proximos7dias') {
      const em7dias = new Date();
      em7dias.setDate(em7dias.getDate() + 7);
      where.dataEntrega = { gte: new Date(), lte: em7dias };
      where.concluido = false;
    } else if (query.vencimento === 'sem_data') {
      where.dataEntrega = null;
    }

    return this.prisma.kanbanCard.findMany({
      where,
      orderBy: [{ lista: { posicao: 'asc' } }, { posicao: 'asc' }],
      include: {
        lista: { select: { id: true, nome: true } },
        etiquetas: { include: { etiqueta: true } },
        membros: { include: { usuario: USUARIO_RESUMO } },
      },
    });
  }
}
