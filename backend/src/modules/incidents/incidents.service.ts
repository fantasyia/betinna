import { Injectable, Logger } from '@nestjs/common';
import { type MarketplaceIncident, type Prisma, MarketplaceIncidentStatus } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type { ListIncidentsDto } from './incidents.dto';
import type { IncidenteEntranteParams } from './incidents.types';

const incidentInclude = {
  cliente: { select: { id: true, nome: true, telefone: true } },
  conversations: {
    select: { id: true, status: true, ultimaMsgEm: true, naoLidas: true },
    orderBy: { ultimaMsgEm: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.MarketplaceIncidentInclude;

type IncidentWithRel = Prisma.MarketplaceIncidentGetPayload<{
  include: typeof incidentInclude;
}>;

/**
 * Gestão de incidentes (reclamações, devoluções, mediações, disputas) vindos
 * dos marketplaces.
 *
 * Canal-agnóstica: ML/Shopee/Amazon/TikTok usam o mesmo modelo via
 * `registrarIncidente()`. Cada marketplace é responsável de mapear seu status
 * próprio pro enum unificado `MarketplaceIncidentStatus`.
 *
 * Política de visibilidade:
 *  - ADMIN/DIRECTOR/GERENTE/SAC: tudo da empresa
 *  - REP: incidentes de clientes da própria carteira
 */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Visibilidade ────────────────────────────────────────────────────

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private baseWhere(user: AuthenticatedUser): Prisma.MarketplaceIncidentWhereInput {
    const where: Prisma.MarketplaceIncidentWhereInput = {
      empresaId: this.requireEmpresa(user),
    };
    // Incidents marketplace é SAC interno — REP não acessa.
    if (user.role === 'REP') {
      throw new ForbiddenException(
        'Incidentes marketplace restritos a SAC/gerência',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return where;
  }

  // ─── Listagem ────────────────────────────────────────────────────────

  async list(
    user: AuthenticatedUser,
    params: ListIncidentsDto,
  ): Promise<Paginated<IncidentWithRel>> {
    const where: Prisma.MarketplaceIncidentWhereInput = { ...this.baseWhere(user) };
    const conds: Prisma.MarketplaceIncidentWhereInput[] = [];

    if (params.canal) conds.push({ canal: params.canal });
    if (params.tipo) conds.push({ tipo: params.tipo });
    if (params.status) conds.push({ status: params.status });
    if (params.clienteId) conds.push({ clienteId: params.clienteId });
    if (params.aguardandoMim) {
      conds.push({
        OR: [
          { status: MarketplaceIncidentStatus.AGUARDANDO_VENDEDOR },
          { status: MarketplaceIncidentStatus.ABERTO },
        ],
      });
    }
    if (params.prazoUrgente) {
      const limite = new Date(Date.now() + 24 * 60 * 60 * 1000);
      conds.push({ prazoResposta: { lte: limite, gte: new Date() } });
    }
    if (conds.length > 0) {
      where.AND = [...((where.AND as Prisma.MarketplaceIncidentWhereInput[]) ?? []), ...conds];
    }

    const [total, data] = await Promise.all([
      this.prisma.marketplaceIncident.count({ where }),
      this.prisma.marketplaceIncident.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: [
          // Aguardando vendedor primeiro
          { prazoResposta: 'asc' },
          { abertoEm: 'desc' },
        ],
        include: incidentInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<IncidentWithRel> {
    const inc = await this.prisma.marketplaceIncident.findFirst({
      where: { id, ...this.baseWhere(user) },
      include: incidentInclude,
    });
    if (!inc) throw new NotFoundException('MarketplaceIncident', id);
    return inc;
  }

  /** Resumo rápido — usado pra widgets no dashboard. */
  async resumo(user: AuthenticatedUser): Promise<{
    aguardandoMim: number;
    prazoUrgente: number;
    emMediacao: number;
    porCanal: Array<{ canal: string; total: number; aguardandoMim: number }>;
  }> {
    const baseWhere = this.baseWhere(user);
    const dentroDe24h = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [aguardando, urgente, mediacao, porCanal] = await Promise.all([
      this.prisma.marketplaceIncident.count({
        where: {
          ...baseWhere,
          status: {
            in: [MarketplaceIncidentStatus.AGUARDANDO_VENDEDOR, MarketplaceIncidentStatus.ABERTO],
          },
        },
      }),
      this.prisma.marketplaceIncident.count({
        where: { ...baseWhere, prazoResposta: { gte: new Date(), lte: dentroDe24h } },
      }),
      this.prisma.marketplaceIncident.count({
        where: { ...baseWhere, status: MarketplaceIncidentStatus.EM_MEDIACAO },
      }),
      this.prisma.marketplaceIncident.groupBy({
        by: ['canal'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      aguardandoMim: aguardando,
      prazoUrgente: urgente,
      emMediacao: mediacao,
      porCanal: porCanal.map((c) => ({
        canal: c.canal,
        total: c._count._all,
        aguardandoMim: 0, // simplificação — UI pode chamar com filtro específico
      })),
    };
  }

  // ─── Registro (chamado pelos adapters de marketplace) ────────────────

  async registrarIncidente(
    params: IncidenteEntranteParams,
  ): Promise<{ incidentId: string; duplicada: boolean }> {
    const existente = await this.prisma.marketplaceIncident.findUnique({
      where: {
        empresaId_canal_externalId: {
          empresaId: params.empresaId,
          canal: params.canal,
          externalId: params.externalId,
        },
      },
      select: { id: true, status: true, atualizadoEm: true },
    });

    const data: Prisma.MarketplaceIncidentUncheckedCreateInput = {
      empresaId: params.empresaId,
      canal: params.canal,
      externalId: params.externalId,
      tipo: params.tipo,
      status: params.status,
      motivo: params.motivo ?? null,
      motivoCodigo: params.motivoCodigo ?? null,
      pedidoExternoId: params.pedidoExternoId ?? null,
      clienteId: params.clienteId ?? null,
      valor: params.valor ?? null,
      valorReembolso: params.valorReembolso ?? null,
      prazoResposta: params.prazoResposta ?? null,
      resumo: params.resumo ?? null,
      metadata: (params.metadata as Prisma.InputJsonValue) ?? undefined,
      resolvidoEm:
        params.status === MarketplaceIncidentStatus.RESOLVIDO ||
        params.status === MarketplaceIncidentStatus.CANCELADO ||
        params.status === MarketplaceIncidentStatus.EXPIRADO
          ? new Date()
          : null,
    };

    if (existente) {
      // Atualização: preserva criadoEm/abertoEm; atualiza status + resumo
      await this.prisma.marketplaceIncident.update({
        where: { id: existente.id },
        data,
      });
      if (params.conversationId) {
        await this.prisma.conversation.update({
          where: { id: params.conversationId },
          data: { incidentId: existente.id },
        });
      }
      this.logger.log(
        `[${params.canal}] incidente ${params.externalId} atualizado → ${params.status}`,
      );
      return { incidentId: existente.id, duplicada: existente.status === params.status };
    }

    const novo = await this.prisma.marketplaceIncident.create({ data });
    if (params.conversationId) {
      await this.prisma.conversation.update({
        where: { id: params.conversationId },
        data: { incidentId: novo.id },
      });
    }
    this.logger.log(
      `[${params.canal}] incidente ${params.externalId} aberto (${params.tipo}/${params.status})`,
    );
    return { incidentId: novo.id, duplicada: false };
  }

  /** Atualiza status e resolvidoEm sem tocar em outros campos. */
  async atualizarStatus(
    empresaId: string,
    canal: string,
    externalId: string,
    status: MarketplaceIncidentStatus,
  ): Promise<MarketplaceIncident | null> {
    return this.prisma.marketplaceIncident
      .update({
        where: {
          empresaId_canal_externalId: { empresaId, canal: canal as never, externalId },
        },
        data: {
          status,
          resolvidoEm:
            status === MarketplaceIncidentStatus.RESOLVIDO ||
            status === MarketplaceIncidentStatus.CANCELADO ||
            status === MarketplaceIncidentStatus.EXPIRADO
              ? new Date()
              : null,
        },
      })
      .catch(() => null);
  }
}
