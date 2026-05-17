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

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

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
