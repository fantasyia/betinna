import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import { empresaFilter, getCallerEmpresaId, isGlobalAdmin } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type { FecharMesDto, ListComissoesDto, MarcarPagoDto } from './comissoes.dto';

const comissaoInclude = {
  representante: { select: { id: true, nome: true, email: true, regiao: true } },
} satisfies Prisma.ComissaoInclude;

type ComissaoWithRel = Prisma.ComissaoGetPayload<{ include: typeof comissaoInclude }>;

/**
 * Status de pedido considerados para cálculo de comissão.
 * Após enviado ao OMIE, a venda já conta — comissão é paga ao final do mês.
 */
const STATUS_COMISSIONAVEL = ['ENVIADO_OMIE', 'PAGO', 'EM_SEPARACAO', 'ENVIADO', 'ENTREGUE'];

@Injectable()
export class ComissoesService {
  private readonly logger = new Logger(ComissoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
  ) {}

  /**
   * Filtro de tenant universal — auditoria 2026-05-15, P0-1.
   * ADMIN: vê todas as empresas. DIRECTOR/GERENTE/REP/SAC: só a empresa ativa.
   */
  private tenantFilter(user: AuthenticatedUser): { empresaId?: string } {
    return empresaFilter(user);
  }

  async list(
    user: AuthenticatedUser,
    params: ListComissoesDto,
  ): Promise<Paginated<ComissaoWithRel>> {
    // ADMIN não precisa de empresa ativa; demais sim.
    if (!isGlobalAdmin(user)) getCallerEmpresaId(user);

    const where: Prisma.ComissaoWhereInput = { ...this.tenantFilter(user) };
    if (params.ano) where.ano = params.ano;
    if (params.mes) where.mes = params.mes;
    if (params.representanteId) where.representanteId = params.representanteId;
    if (params.pago !== undefined) where.pago = params.pago;
    if (params.tipo) where.tipo = params.tipo;

    // REP vê só as próprias comissões; GERENTE vê dos REPs sob sua gerência.
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) {
      // Se já tem filtro de representanteId no params (admin filtrando), preservar
      // mas restringir à intersecção do scope.
      if (params.representanteId && !scope.includes(params.representanteId)) {
        // pedido filtro fora do scope → resulta em vazio
        where.id = '__none__';
      } else if (!params.representanteId) {
        where.representanteId = { in: scope };
      }
    }

    const [total, data] = await Promise.all([
      this.prisma.comissao.count({ where }),
      this.prisma.comissao.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: [{ ano: 'desc' }, { mes: 'desc' }, { totalComissao: 'desc' }],
        include: comissaoInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<ComissaoWithRel> {
    // Aplica empresaId no where direto (não findUnique + check depois — auditoria P1-2)
    const comissao = await this.prisma.comissao.findFirst({
      where: { id, ...this.tenantFilter(user) },
      include: comissaoInclude,
    });
    if (!comissao) throw new NotFoundException('Comissão', id);
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null && !scope.includes(comissao.representanteId)) {
      throw new ForbiddenException('Você não tem acesso a esta comissão');
    }
    return comissao;
  }

  /**
   * Fecha o mês: agrega os pedidos commissionáveis por representante
   * e cria/atualiza os registros em Comissao.
   *
   * Só ADMIN/DIRECTOR/GERENTE chamam (controle no controller).
   * Idempotente quando `reprocessar=false` (não recria se já existe).
   *
   * AUDITORIA P0 — todos os registros de Comissao têm `empresaId` e `calculadoEm`
   * gravados explicitamente (snapshot do momento do fechamento).
   */
  async fecharMes(
    user: AuthenticatedUser,
    dto: FecharMesDto,
  ): Promise<{
    ok: true;
    mes: number;
    ano: number;
    representantes: number;
    gerentes: number;
    totalVendas: number;
    totalComissao: number;
  }> {
    // Fechamento SEMPRE requer empresa ativa (mesmo ADMIN — fecha 1 empresa por vez)
    const empresaId = getCallerEmpresaId(user);
    const inicio = new Date(Date.UTC(dto.ano, dto.mes - 1, 1));
    const fim = new Date(Date.UTC(dto.ano, dto.mes, 1));

    // Agrega pedidos do período por representante.
    // GERENTE deve agregar apenas os pedidos dos próprios reps; ADMIN/DIRECTOR
    // agregam todos da empresa.
    const repScopeIds = await this.repScope.getRepIds(user);
    const baseWhere: Prisma.PedidoWhereInput = {
      empresaId,
      status: { in: STATUS_COMISSIONAVEL as Prisma.EnumPedidoStatusFilter['in'] },
      representanteId: { not: null },
      enviadoOmieEm: { gte: inicio, lt: fim },
    };
    if (repScopeIds !== null) {
      baseWhere.representanteId = { in: repScopeIds };
    }

    const aggregated = await this.prisma.pedido.groupBy({
      by: ['representanteId'],
      where: baseWhere,
      _sum: { total: true, comissao: true },
      _count: { _all: true },
    });

    if (aggregated.length === 0) {
      this.logger.warn(
        `Nenhum pedido comissionável encontrado para ${dto.mes}/${dto.ano} (empresa ${empresaId})`,
      );
      return {
        ok: true,
        mes: dto.mes,
        ano: dto.ano,
        representantes: 0,
        gerentes: 0,
        totalVendas: 0,
        totalComissao: 0,
      };
    }

    let totalVendasAgg = 0;
    let totalComissaoAgg = 0;

    // Para gravar `percentual` no snapshot do REP precisamos saber a comissão
    // padrão de cada rep no momento atual (carrega 1x em batch).
    const repIds = aggregated
      .map((r) => r.representanteId)
      .filter((id): id is string => id !== null);
    const repsConfig = await this.prisma.usuario.findMany({
      where: { id: { in: repIds } },
      select: { id: true, comissaoPadrao: true },
    });
    const pctPorRep = new Map(repsConfig.map((r) => [r.id, r.comissaoPadrao ?? null]));

    const agora = new Date();

    await this.prisma.$transaction(
      aggregated
        .filter(
          (row): row is typeof row & { representanteId: string } => row.representanteId !== null,
        )
        .map((row) => {
          const totalVendas = row._sum.total ?? 0;
          const totalComissao = row._sum.comissao ?? 0;
          totalVendasAgg += totalVendas;
          totalComissaoAgg += totalComissao;
          const pctRep = pctPorRep.get(row.representanteId) ?? null;
          return this.prisma.comissao.upsert({
            where: {
              empresaId_representanteId_ano_mes: {
                empresaId,
                representanteId: row.representanteId,
                ano: dto.ano,
                mes: dto.mes,
              },
            },
            update: dto.reprocessar
              ? {
                  totalVendas,
                  totalComissao,
                  qtdPedidos: row._count._all,
                  tipo: 'REP',
                  // Snapshot preserva o `percentual` original — auditoria P0-2.
                  // Não reescrevemos se já existe valor (mantém histórico fidedigno).
                }
              : {},
            create: {
              empresaId,
              representanteId: row.representanteId,
              tipo: 'REP',
              // AUDITORIA P0-2: snapshot de percentual ANTES era null. Agora preservamos.
              percentual: pctRep,
              calculadoEm: agora,
              ano: dto.ano,
              mes: dto.mes,
              totalVendas,
              totalComissao,
              qtdPedidos: row._count._all,
              pago: false,
            },
          });
        }),
    );

    // Comissão dos GERENTES: total de vendas dos REPs sob sua gerência × % do gerente.
    const reps = await this.prisma.usuario.findMany({
      where: { id: { in: repIds }, role: 'REP' },
      select: { id: true, gerenteId: true },
    });
    const vendasPorRep = new Map<string, number>();
    for (const row of aggregated) {
      if (row.representanteId) {
        vendasPorRep.set(row.representanteId, row._sum.total ?? 0);
      }
    }
    const vendasPorGerente = new Map<string, number>();
    for (const r of reps) {
      if (!r.gerenteId) continue;
      const v = vendasPorRep.get(r.id) ?? 0;
      vendasPorGerente.set(r.gerenteId, (vendasPorGerente.get(r.gerenteId) ?? 0) + v);
    }

    let gerentesProcessados = 0;
    if (vendasPorGerente.size > 0) {
      const gerentes = await this.prisma.usuario.findMany({
        where: { id: { in: Array.from(vendasPorGerente.keys()) }, role: 'GERENTE' },
        select: { id: true, comissaoPadrao: true },
      });

      // Pra reprocessar=true, lemos o `percentual` JÁ GRAVADO para preservar
      // snapshot histórico — auditoria P0-1.
      const existentesGerente = await this.prisma.comissao.findMany({
        where: {
          empresaId,
          tipo: 'GERENTE',
          ano: dto.ano,
          mes: dto.mes,
          representanteId: { in: gerentes.map((g) => g.id) },
        },
        select: { representanteId: true, percentual: true },
      });
      const pctSalvoPorGerente = new Map(
        existentesGerente.map((e) => [e.representanteId, e.percentual]),
      );

      await this.prisma.$transaction(
        gerentes.map((g) => {
          const totalVendas = vendasPorGerente.get(g.id) ?? 0;
          // Snapshot: se já existe percentual salvo, usa ele; senão pega o atual
          const pctSalvo = pctSalvoPorGerente.get(g.id);
          const pct = pctSalvo ?? g.comissaoPadrao ?? 0;
          const totalComissao = Math.round(totalVendas * (pct / 100) * 100) / 100;
          gerentesProcessados += 1;
          return this.prisma.comissao.upsert({
            where: {
              empresaId_representanteId_ano_mes: {
                empresaId,
                representanteId: g.id,
                ano: dto.ano,
                mes: dto.mes,
              },
            },
            update: dto.reprocessar
              ? {
                  totalVendas,
                  totalComissao,
                  qtdPedidos: 0,
                  tipo: 'GERENTE',
                  // Mantém `percentual` original (snapshot fidedigno do fechamento)
                }
              : {},
            create: {
              empresaId,
              representanteId: g.id,
              tipo: 'GERENTE',
              percentual: pct,
              calculadoEm: agora,
              ano: dto.ano,
              mes: dto.mes,
              totalVendas,
              totalComissao,
              qtdPedidos: 0,
              pago: false,
            },
          });
        }),
      );
      // Soma usando o pct snapshotado
      totalComissaoAgg += gerentes.reduce((sum, g) => {
        const v = vendasPorGerente.get(g.id) ?? 0;
        const pctSalvo = pctSalvoPorGerente.get(g.id);
        const pct = pctSalvo ?? g.comissaoPadrao ?? 0;
        return sum + Math.round(v * (pct / 100) * 100) / 100;
      }, 0);
    }

    this.logger.log(
      `Fechamento ${dto.mes}/${dto.ano} (empresa ${empresaId}): ${aggregated.length} reps + ${gerentesProcessados} gerentes · R$${totalVendasAgg.toFixed(2)} vendas · R$${totalComissaoAgg.toFixed(2)} comissão`,
    );

    return {
      ok: true,
      mes: dto.mes,
      ano: dto.ano,
      representantes: aggregated.length,
      gerentes: gerentesProcessados,
      totalVendas: totalVendasAgg,
      totalComissao: totalComissaoAgg,
    };
  }

  async marcarPago(
    user: AuthenticatedUser,
    id: string,
    dto: MarcarPagoDto,
  ): Promise<ComissaoWithRel> {
    // findById aplica tenant + scope
    await this.findById(user, id);

    // AUDITORIA P0-4: idempotente via updateMany com WHERE pago=false.
    // Duas requests concorrentes → apenas uma terá count===1.
    const where: Prisma.ComissaoWhereInput = {
      id,
      pago: false,
      ...this.tenantFilter(user),
    };
    const { count } = await this.prisma.comissao.updateMany({
      where,
      data: { pago: true, pagoEm: new Date(), reciboUrl: dto.reciboUrl },
    });
    if (count === 0) {
      throw new BusinessRuleException('Comissão já está marcada como paga');
    }
    return this.findById(user, id);
  }

  async desmarcarPago(user: AuthenticatedUser, id: string): Promise<ComissaoWithRel> {
    await this.findById(user, id);
    const where: Prisma.ComissaoWhereInput = {
      id,
      pago: true,
      ...this.tenantFilter(user),
    };
    const { count } = await this.prisma.comissao.updateMany({
      where,
      data: { pago: false, pagoEm: null, reciboUrl: null },
    });
    if (count === 0) {
      throw new BusinessRuleException('Comissão não está marcada como paga');
    }
    return this.findById(user, id);
  }

  /**
   * Resumo da comissão pessoal do rep (dashboard do rep).
   * Mostra 6 meses anteriores + total acumulado do ano + meta vs realizado.
   */
  async resumoDoRep(user: AuthenticatedUser): Promise<{
    representanteId: string;
    anoAtual: number;
    totalRecebidoAnoAtual: number;
    totalAReceberAnoAtual: number;
    historico: ComissaoWithRel[];
  }> {
    if (
      user.role !== 'REP' &&
      user.role !== 'GERENTE' &&
      user.role !== 'ADMIN' &&
      user.role !== 'DIRECTOR'
    ) {
      throw new ForbiddenException('Apenas representantes/gerentes consultam o próprio resumo');
    }
    // Mesmo ADMIN vê seu próprio resumo via empresa ativa (não cross-tenant)
    const repId = user.id;
    const ano = new Date().getUTCFullYear();
    const historico = await this.prisma.comissao.findMany({
      where: {
        representanteId: repId,
        ...this.tenantFilter(user),
      },
      orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
      take: 12,
      include: comissaoInclude,
    });
    const totalRecebido = historico
      .filter((c) => c.ano === ano && c.pago)
      .reduce((s, c) => s + c.totalComissao, 0);
    const totalAReceber = historico
      .filter((c) => c.ano === ano && !c.pago)
      .reduce((s, c) => s + c.totalComissao, 0);
    return {
      representanteId: repId,
      anoAtual: ano,
      totalRecebidoAnoAtual: totalRecebido,
      totalAReceberAnoAtual: totalAReceber,
      historico,
    };
  }
}
