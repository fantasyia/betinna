import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';

export interface AuditEntry {
  usuarioId?: string | null;
  empresaId?: string | null;
  acao: string;
  recurso: string;
  recursoId?: string | null;
  detalhes?: Prisma.InputJsonValue;
  ip?: string | null;
}

/**
 * Serviço de auditoria.
 *
 * Gravação assíncrona (não bloqueia request). Falhas em audit log nunca
 * derrubam a operação principal — só logam.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  log(entry: AuditEntry): void {
    this.prisma.auditLog
      .create({
        data: {
          usuarioId: entry.usuarioId ?? null,
          empresaId: entry.empresaId ?? null,
          acao: entry.acao,
          recurso: entry.recurso,
          recursoId: entry.recursoId ?? null,
          detalhes: entry.detalhes ?? Prisma.JsonNull,
          ip: entry.ip ?? null,
        },
      })
      .catch((err: unknown) => {
        this.logger.error(`Falha ao gravar audit log: ${this.message(err)}`);
      });
  }

  /** Sobrecarga síncrona pra cenários raros onde precisamos esperar */
  async logSync(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          usuarioId: entry.usuarioId ?? null,
          empresaId: entry.empresaId ?? null,
          acao: entry.acao,
          recurso: entry.recurso,
          recursoId: entry.recursoId ?? null,
          detalhes: entry.detalhes ?? Prisma.JsonNull,
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao gravar audit log: ${this.message(err)}`);
    }
  }

  // ─── Consulta (ADMIN viewer) ─────────────────────────────────────────

  /**
   * Nome de GENTE e de COISA ao lado dos ids (pedido do Léo, 24/09).
   *
   * A tela mostrava `10fb0fca-5af3-…` e `cmtvasp1f0030o2…`: pra responder "quem
   * desligou o R2?" era preciso traduzir código na mão. Os nomes são buscados em
   * LOTE (uma consulta por tipo de recurso da página), não linha a linha.
   *
   * Best-effort: tipo sem tradutor, ou registro que já foi apagado, fica com o
   * nome `null` e o id continua lá — a linha de auditoria nunca some por isso.
   */
  private async comNomes<
    T extends { usuarioId: string | null; recurso: string; recursoId: string | null },
  >(linhas: T[]): Promise<Array<T & { usuarioNome: string | null; recursoNome: string | null }>> {
    const idsDe = (recurso: string) => [
      ...new Set(
        linhas
          .filter((l) => l.recurso === recurso && l.recursoId)
          .map((l) => l.recursoId as string),
      ),
    ];
    const tradutores: Record<string, (ids: string[]) => Promise<Array<[string, string]>>> = {
      fluxo: async (ids) =>
        (
          await this.prisma.fluxo.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        ).map((r) => [r.id, r.nome]),
      fluxo_execucao: async (ids) =>
        (
          await this.prisma.fluxoExecucao.findMany({
            where: { id: { in: ids } },
            select: { id: true, fluxo: { select: { nome: true } } },
          })
        ).map((r) => [r.id, `execução de ${r.fluxo.nome}`]),
      proposta: async (ids) =>
        (
          await this.prisma.proposta.findMany({
            where: { id: { in: ids } },
            select: { id: true, numero: true },
          })
        ).map((r) => [r.id, r.numero]),
      pedido: async (ids) =>
        (
          await this.prisma.pedido.findMany({
            where: { id: { in: ids } },
            select: { id: true, numero: true },
          })
        ).map((r) => [r.id, r.numero]),
      contrato: async (ids) =>
        (
          await this.prisma.contrato.findMany({
            where: { id: { in: ids } },
            select: { id: true, proposta: { select: { numero: true } } },
          })
        ).map((r) => [r.id, `contrato da ${r.proposta.numero}`]),
      modelo_contrato: async (ids) =>
        (
          await this.prisma.modeloContrato.findMany({
            where: { id: { in: ids } },
            select: { id: true, versao: true },
          })
        ).map((r) => [r.id, `modelo de contrato v${r.versao}`]),
      cliente: async (ids) =>
        (
          await this.prisma.cliente.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        ).map((r) => [r.id, r.nome]),
      lead: async (ids) =>
        (
          await this.prisma.lead.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        ).map((r) => [r.id, r.nome]),
      usuario: async (ids) =>
        (
          await this.prisma.usuario.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        ).map((r) => [r.id, r.nome]),
      funil: async (ids) =>
        (
          await this.prisma.funil.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        ).map((r) => [r.id, r.nome]),
      campanha: async (ids) =>
        (
          await this.prisma.campanha.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        ).map((r) => [r.id, r.nome]),
      kanban_board: async (ids) =>
        (
          await this.prisma.kanbanBoard.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        ).map((r) => [r.id, r.nome]),
      kanban_card: async (ids) =>
        (
          await this.prisma.kanbanCard.findMany({
            where: { id: { in: ids } },
            select: { id: true, titulo: true },
          })
        ).map((r) => [r.id, r.titulo]),
      // Item sozinho ("Push") não diz nada — leva o título do card junto. É o tipo
      // mais frequente do log (toda sessão marca checklist).
      kanban_checklist: async (ids) =>
        (
          await this.prisma.kanbanChecklist.findMany({
            where: { id: { in: ids } },
            select: { id: true, titulo: true, card: { select: { titulo: true } } },
          })
        ).map((r) => [r.id, `${r.titulo} — em ${r.card.titulo}`]),
      kanban_checklist_item: async (ids) =>
        (
          await this.prisma.kanbanChecklistItem.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              texto: true,
              checklist: { select: { card: { select: { titulo: true } } } },
            },
          })
        ).map((r) => [r.id, `${r.texto} — em ${r.checklist.card.titulo}`]),
      tag: async (ids) =>
        (
          await this.prisma.tag.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        ).map((r) => [r.id, r.nome]),
      empresa: async (ids) =>
        (
          await this.prisma.empresa.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        ).map((r) => [r.id, r.nome]),
    };

    const nomeDoRecurso = new Map<string, string>(); // `${recurso}:${id}` → nome
    await Promise.all(
      Object.entries(tradutores).map(async ([recurso, traduzir]) => {
        const ids = idsDe(recurso);
        if (!ids.length) return;
        try {
          for (const [id, nome] of await traduzir(ids)) nomeDoRecurso.set(`${recurso}:${id}`, nome);
        } catch (err) {
          this.logger.warn(`Auditoria: não traduzi nomes de ${recurso}: ${this.message(err)}`);
        }
      }),
    );

    const usuarioIds = [...new Set(linhas.map((l) => l.usuarioId).filter(Boolean))] as string[];
    const nomeDoUsuario = new Map<string, string>();
    if (usuarioIds.length) {
      try {
        const us = await this.prisma.usuario.findMany({
          where: { id: { in: usuarioIds } },
          select: { id: true, nome: true },
        });
        for (const u of us) nomeDoUsuario.set(u.id, u.nome);
      } catch (err) {
        this.logger.warn(`Auditoria: não traduzi nomes de usuário: ${this.message(err)}`);
      }
    }

    return linhas.map((l) => ({
      ...l,
      usuarioNome: l.usuarioId ? (nomeDoUsuario.get(l.usuarioId) ?? null) : null,
      recursoNome: l.recursoId ? (nomeDoRecurso.get(`${l.recurso}:${l.recursoId}`) ?? null) : null,
    }));
  }

  async list(params: {
    page?: number;
    limit?: number;
    empresaId?: string;
    usuarioId?: string;
    acao?: string;
    recurso?: string;
    recursoId?: string;
    de?: Date;
    ate?: Date;
  }): Promise<{
    data: Array<{
      id: string;
      acao: string;
      recurso: string;
      recursoId: string | null;
      usuarioId: string | null;
      empresaId: string | null;
      detalhes: Prisma.JsonValue;
      ip: string | null;
      criadoEm: Date;
      /** Nome de quem fez (null = sistema, ou usuário apagado). */
      usuarioNome: string | null;
      /** Nome legível do recurso (fluxo, proposta…); null = tipo sem tradutor ou apagado. */
      recursoNome: string | null;
    }>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));

    const where: Prisma.AuditLogWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.usuarioId) where.usuarioId = params.usuarioId;
    if (params.acao) where.acao = { contains: params.acao, mode: 'insensitive' };
    if (params.recurso) where.recurso = params.recurso;
    if (params.recursoId) where.recursoId = params.recursoId;
    if (params.de || params.ate) {
      where.criadoEm = {};
      if (params.de) where.criadoEm.gte = params.de;
      if (params.ate) where.criadoEm.lte = params.ate;
    }

    const [linhas, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const data = await this.comNomes(linhas);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findById(id: string): Promise<{
    id: string;
    acao: string;
    recurso: string;
    recursoId: string | null;
    usuarioId: string | null;
    empresaId: string | null;
    detalhes: Prisma.JsonValue;
    ip: string | null;
    criadoEm: Date;
  } | null> {
    return this.prisma.auditLog.findUnique({ where: { id } });
  }

  /** Lista valores únicos de `recurso` pra dropdown de filtros. */
  async listRecursosUnicos(): Promise<string[]> {
    const r = await this.prisma.auditLog.groupBy({
      by: ['recurso'],
      orderBy: { recurso: 'asc' },
    });
    return r.map((x) => x.recurso);
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
