import { Injectable, Logger } from '@nestjs/common';
import type { Notificacao, NotificacaoPrioridade, NotificacaoTipo, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { CriarNotificacaoDto, ListNotificacoesDto } from './notificacoes.dto';

/**
 * NotificacoesService — notificações in-app persistidas por usuário.
 *
 * Triggers chamam `criar(...)` para enfileirar. Frontend faz polling
 * em `/notificacoes` (default 30s) — solução pragmática vs WebSocket
 * pra MVP (deploy mais simples no Railway, sem sticky session).
 *
 * Best-effort: falha ao criar notificação NUNCA derruba a operação
 * principal (criação de pedido, ocorrência, etc).
 */
@Injectable()
export class NotificacoesService {
  private readonly logger = new Logger(NotificacoesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    const empresaId = getCallerEmpresaId(user);
    if (!empresaId) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return empresaId;
  }

  // ─── Trigger interno (chamado por outros services) ──────────────────

  /**
   * Cria uma notificação. Best-effort — captura exceções e loga warn
   * para não derrubar quem chamou.
   *
   * @param params dados da notificação. `empresaId` deduzido do contexto.
   */
  async criarParaUsuario(params: {
    empresaId: string;
    usuarioId: string;
    tipo: NotificacaoTipo;
    titulo: string;
    mensagem: string;
    link?: string | null;
    prioridade?: NotificacaoPrioridade;
    metadata?: Prisma.InputJsonValue | null;
  }): Promise<Notificacao | null> {
    try {
      return await this.prisma.notificacao.create({
        data: {
          empresaId: params.empresaId,
          usuarioId: params.usuarioId,
          tipo: params.tipo,
          prioridade: params.prioridade ?? 'NORMAL',
          titulo: params.titulo.slice(0, 160),
          mensagem: params.mensagem.slice(0, 500),
          link: params.link ?? null,
          metadata: params.metadata ?? undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Falha criando notificação para user=${params.usuarioId} tipo=${params.tipo}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Helper: cria notificação para todos os usuários com um papel específico
   * dentro de uma empresa.
   */
  async criarParaRole(params: {
    empresaId: string;
    roles: Array<'ADMIN' | 'DIRECTOR' | 'GERENTE' | 'SAC' | 'REP'>;
    tipo: NotificacaoTipo;
    titulo: string;
    mensagem: string;
    link?: string | null;
    prioridade?: NotificacaoPrioridade;
    metadata?: Prisma.InputJsonValue | null;
  }): Promise<number> {
    try {
      const users = await this.prisma.usuario.findMany({
        where: {
          status: 'ATIVO',
          role: { in: params.roles },
          empresas: { some: { empresaId: params.empresaId } },
        },
        select: { id: true },
      });
      if (users.length === 0) return 0;
      const data = users.map((u) => ({
        empresaId: params.empresaId,
        usuarioId: u.id,
        tipo: params.tipo,
        prioridade: params.prioridade ?? 'NORMAL',
        titulo: params.titulo.slice(0, 160),
        mensagem: params.mensagem.slice(0, 500),
        link: params.link ?? null,
        metadata: params.metadata ?? undefined,
      }));
      const r = await this.prisma.notificacao.createMany({ data });
      return r.count;
    } catch (err) {
      this.logger.warn(
        `Falha criarParaRole empresa=${params.empresaId} roles=${params.roles.join(',')} tipo=${
          params.tipo
        }: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  // ─── Endpoints do controller ────────────────────────────────────────

  async list(user: AuthenticatedUser, params: ListNotificacoesDto) {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.NotificacaoWhereInput = {
      empresaId,
      usuarioId: user.id,
    };
    if (params.apenasNaoLidas) where.lidaEm = null;
    if (params.tipo) where.tipo = params.tipo;
    if (params.prioridade) where.prioridade = params.prioridade;

    const [data, total, unread] = await Promise.all([
      this.prisma.notificacao.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.notificacao.count({ where }),
      this.prisma.notificacao.count({
        where: { empresaId, usuarioId: user.id, lidaEm: null },
      }),
    ]);

    return {
      data,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      },
      naoLidas: unread,
    };
  }

  /** Contagem simples de não-lidas (endpoint barato pra polling). */
  async naoLidas(user: AuthenticatedUser): Promise<{ naoLidas: number }> {
    const empresaId = this.requireEmpresa(user);
    const naoLidas = await this.prisma.notificacao.count({
      where: { empresaId, usuarioId: user.id, lidaEm: null },
    });
    return { naoLidas };
  }

  async marcarLida(user: AuthenticatedUser, id: string): Promise<Notificacao> {
    const empresaId = this.requireEmpresa(user);
    const existe = await this.prisma.notificacao.findFirst({
      where: { id, empresaId, usuarioId: user.id },
    });
    if (!existe) throw new NotFoundException('Notificação', id);
    if (existe.lidaEm) return existe; // idempotente
    return this.prisma.notificacao.update({
      where: { id },
      data: { lidaEm: new Date() },
    });
  }

  async marcarTodasLidas(user: AuthenticatedUser): Promise<{ atualizadas: number }> {
    const empresaId = this.requireEmpresa(user);
    const r = await this.prisma.notificacao.updateMany({
      where: { empresaId, usuarioId: user.id, lidaEm: null },
      data: { lidaEm: new Date() },
    });
    return { atualizadas: r.count };
  }

  async deletar(user: AuthenticatedUser, id: string): Promise<{ ok: true }> {
    const empresaId = this.requireEmpresa(user);
    const existe = await this.prisma.notificacao.findFirst({
      where: { id, empresaId, usuarioId: user.id },
    });
    if (!existe) throw new NotFoundException('Notificação', id);
    await this.prisma.notificacao.delete({ where: { id } });
    return { ok: true };
  }

  /** Criar via API (ADMIN/DIRECTOR — notificação manual broadcast). */
  async criarManual(
    user: AuthenticatedUser,
    dto: CriarNotificacaoDto,
  ): Promise<Notificacao | null> {
    const empresaId = this.requireEmpresa(user);
    return this.criarParaUsuario({
      empresaId,
      usuarioId: dto.usuarioId,
      tipo: dto.tipo,
      prioridade: dto.prioridade,
      titulo: dto.titulo,
      mensagem: dto.mensagem,
      link: dto.link,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    });
  }
}
