import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import {
  empresaFilter,
  getCallerEmpresaId,
  isGlobalAdmin,
} from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { PeriodoDto } from './relatorios.dto';

// ─── Helpers internos ────────────────────────────────────────────────────────

/** Período imediatamente anterior com a mesma duração (para comparativo %). */
function periodoAnterior(de: Date, ate: Date): { de: Date; ate: Date } {
  const duracao = ate.getTime() - de.getTime();
  return {
    de: new Date(de.getTime() - duracao),
    ate: new Date(de.getTime()),
  };
}

function variacao(atual: number, anterior: number): number {
  if (anterior === 0) return atual > 0 ? 100 : 0;
  return Math.round(((atual - anterior) / anterior) * 100);
}

function arredondar(v: number | null | undefined): number {
  return Math.round((v ?? 0) * 100) / 100;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class RelatoriosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
  ) {}

  // ─── Auth ─────────────────────────────────────────────────────────────

  /**
   * Para relatórios, todos os usuários (incluindo ADMIN) operam em UMA empresa
   * por vez (via header X-Empresa-Id). Cross-tenant view foge ao escopo do
   * dashboard atual.
   */
  private requireEmpresa(user: AuthenticatedUser): string {
    return getCallerEmpresaId(user);
  }

  /**
   * Retorna filtro de representanteId respeitando o papel do usuário.
   * Auditoria 2026-05-15 P0-6: tipo consistente — sempre retorna Filter ou undefined.
   *
   * - ADMIN/DIRECTOR/SAC: sem restrição (usa `params.representanteId` se informado)
   * - GERENTE: restringe aos REPs sob gerência (intersecção com paramRepId)
   * - REP: apenas os próprios dados
   */
  private async repFilter(
    user: AuthenticatedUser,
    paramRepId?: string,
  ): Promise<Prisma.StringNullableFilter | undefined> {
    const scope = await this.repScope.getRepIds(user);
    if (scope === null) {
      // Sem restrição por papel; usa filtro manual se informado
      return paramRepId ? { equals: paramRepId } : undefined;
    }
    // scope é string[] (pode ser vazio = bloqueia tudo)
    if (paramRepId && scope.includes(paramRepId)) {
      return { equals: paramRepId };
    }
    return { in: scope };
  }

  /**
   * Helper para aplicar o filtro de representanteId em um where Prisma.
   * Se `repFilter` for undefined, não adiciona nada.
   *
   * Tipo usa `Record<string, unknown>` interno pra evitar variância de generics
   * cross-model (Pedido vs Lead). Os call sites sabem qual model é.
   */
  private mergeRepFilter<W extends Record<string, unknown>>(
    where: W,
    rf: Prisma.StringNullableFilter | undefined,
  ): W {
    if (rf !== undefined) {
      (where as Record<string, unknown>).representanteId = rf;
    }
    return where;
  }

  // ─── Enriquecimento de IDs → Nomes ────────────────────────────────────

  private async nomesReps(repIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(repIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const reps = await this.prisma.usuario.findMany({
      where: { id: { in: ids } },
      select: { id: true, nome: true },
    });
    return new Map(reps.map((r) => [r.id, r.nome]));
  }

  // ─── 1. Vendas ────────────────────────────────────────────────────────

  async vendas(user: AuthenticatedUser, params: PeriodoDto) {
    const empresaId = this.requireEmpresa(user);
    const rf = await this.repFilter(user, params.representanteId);
    const { de, ate } = params;
    const prev = periodoAnterior(de, ate);

    // Auditoria: removido 'REJEITADO' que não existe no enum PedidoStatus.
    const statusReceita = {
      notIn: ['RASCUNHO', 'CANCELADO', 'AGUARDANDO_APROVACAO'],
    } as Prisma.EnumPedidoStatusFilter;

    const baseWhere = (inicio: Date, fim: Date): Prisma.PedidoWhereInput =>
      this.mergeRepFilter(
        {
          empresaId,
          criadoEm: { gte: inicio, lte: fim },
        } as Prisma.PedidoWhereInput,
        rf,
      );

    const [
      aggrAtual,
      aggrAnterior,
      porStatus,
      porRepGrp,
      pedidosEntregues,
    ] = await Promise.all([
      this.prisma.pedido.aggregate({
        where: { ...baseWhere(de, ate), status: statusReceita },
        _sum: { total: true },
        _count: { _all: true },
        _avg: { total: true },
      }),
      this.prisma.pedido.aggregate({
        where: { ...baseWhere(prev.de, prev.ate), status: statusReceita },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.pedido.groupBy({
        by: ['status'],
        where: baseWhere(de, ate),
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.pedido.groupBy({
        by: ['representanteId'],
        where: { ...baseWhere(de, ate), status: statusReceita },
        _count: { _all: true },
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' } },
      }),
      // Pedidos entregues = receita "efetivamente realizada"
      this.prisma.pedido.aggregate({
        where: { ...baseWhere(de, ate), status: 'ENTREGUE' },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);

    const faturamentoAtual = arredondar(aggrAtual._sum.total);
    const faturamentoAnterior = arredondar(aggrAnterior._sum.total);

    const repIds = porRepGrp.map((r) => r.representanteId);
    const nomes = await this.nomesReps(repIds);

    return {
      periodo: { de, ate },
      faturamento: {
        atual: faturamentoAtual,
        anterior: faturamentoAnterior,
        variacao: variacao(faturamentoAtual, faturamentoAnterior),
      },
      receitaRealizada: arredondar(pedidosEntregues._sum.total),
      totalPedidos: aggrAtual._count._all,
      ticketMedio: arredondar(aggrAtual._avg.total),
      porStatus: porStatus.map((s) => ({
        status: s.status,
        count: s._count._all,
        total: arredondar(s._sum.total),
      })),
      porRep: porRepGrp.map((r) => ({
        repId: r.representanteId,
        repNome: r.representanteId ? (nomes.get(r.representanteId) ?? 'Desconhecido') : 'Sem rep',
        pedidos: r._count._all,
        total: arredondar(r._sum.total),
      })),
    };
  }

  // ─── 2. Funil de leads ────────────────────────────────────────────────

  async funil(user: AuthenticatedUser, params: PeriodoDto) {
    const empresaId = this.requireEmpresa(user);
    const rf = await this.repFilter(user, params.representanteId);
    const { de, ate } = params;
    const prev = periodoAnterior(de, ate);

    const baseFilter: Prisma.LeadWhereInput = this.mergeRepFilter(
      { empresaId } as Prisma.LeadWhereInput,
      rf,
    );

    const [
      porEtapa,
      criadosAtual,
      criadosAnterior,
      ganhosAtual,
      ganhosAnterior,
      perdidosAtual,
      agingGrp,
      porRep,
    ] = await Promise.all([
      // Snapshot atual do funil (independente de período — mostra estado atual)
      this.prisma.lead.groupBy({
        by: ['etapa'],
        where: baseFilter,
        _count: { _all: true },
        _sum: { valorEstimado: true },
      }),
      this.prisma.lead.count({ where: { ...baseFilter, criadoEm: { gte: de, lte: ate } } }),
      this.prisma.lead.count({ where: { ...baseFilter, criadoEm: { gte: prev.de, lte: prev.ate } } }),
      this.prisma.lead.count({
        where: { ...baseFilter, etapa: 'GANHO', fechadoEm: { gte: de, lte: ate } },
      }),
      this.prisma.lead.count({
        where: { ...baseFilter, etapa: 'GANHO', fechadoEm: { gte: prev.de, lte: prev.ate } },
      }),
      this.prisma.lead.count({
        where: { ...baseFilter, etapa: 'PERDIDO', fechadoEm: { gte: de, lte: ate } },
      }),
      // Aging: soma dos dias na etapa atual (etapaDesde)
      this.prisma.lead.findMany({
        where: { ...baseFilter, etapa: { notIn: ['GANHO', 'PERDIDO'] } },
        select: { etapa: true, etapaDesde: true },
      }),
      this.prisma.lead.groupBy({
        by: ['representanteId'],
        where: { ...baseFilter, criadoEm: { gte: de, lte: ate } },
        _count: { _all: true },
        _sum: { valorEstimado: true },
      }),
    ]);

    // Calcula dias médios na etapa por etapa
    const agingPorEtapa: Record<string, number> = {};
    const agora = Date.now();
    for (const lead of agingGrp) {
      const dias = Math.max(
        0,
        Math.floor((agora - lead.etapaDesde.getTime()) / (1000 * 60 * 60 * 24)),
      );
      if (!agingPorEtapa[lead.etapa]) agingPorEtapa[lead.etapa] = 0;
      agingPorEtapa[lead.etapa] += dias;
    }
    const countPorEtapa: Record<string, number> = {};
    for (const lead of agingGrp) {
      countPorEtapa[lead.etapa] = (countPorEtapa[lead.etapa] ?? 0) + 1;
    }
    const agingMedioPorEtapa = Object.fromEntries(
      Object.entries(agingPorEtapa).map(([etapa, soma]) => [
        etapa,
        Math.round(soma / (countPorEtapa[etapa] ?? 1)),
      ]),
    );

    const totalAtivos = porEtapa
      .filter((e) => !['GANHO', 'PERDIDO'].includes(e.etapa))
      .reduce((s, e) => s + e._count._all, 0);
    const taxaConversao =
      criadosAtual > 0 ? Math.round((ganhosAtual / criadosAtual) * 100) : 0;

    const repIds = porRep.map((r) => r.representanteId);
    const nomes = await this.nomesReps(repIds);

    return {
      periodo: { de, ate },
      funilAtual: porEtapa.map((e) => ({
        etapa: e.etapa,
        count: e._count._all,
        valorEstimado: arredondar(e._sum.valorEstimado),
      })),
      totalAtivos,
      criados: {
        atual: criadosAtual,
        anterior: criadosAnterior,
        variacao: variacao(criadosAtual, criadosAnterior),
      },
      ganhos: {
        atual: ganhosAtual,
        anterior: ganhosAnterior,
        variacao: variacao(ganhosAtual, ganhosAnterior),
      },
      perdidos: perdidosAtual,
      taxaConversao,
      agingMedioPorEtapa,
      porRep: porRep.map((r) => ({
        repId: r.representanteId,
        repNome: r.representanteId ? (nomes.get(r.representanteId) ?? 'Desconhecido') : 'Sem rep',
        leads: r._count._all,
        valorEstimado: arredondar(r._sum.valorEstimado),
      })),
    };
  }

  // ─── 3. Comissões ─────────────────────────────────────────────────────

  async comissoes(user: AuthenticatedUser, params: PeriodoDto) {
    const empresaId = this.requireEmpresa(user);
    const rf = await this.repFilter(user, params.representanteId);
    const { de, ate } = params;

    // Converte date range em lista de (ano, mes) para filtrar a tabela Comissao
    const meses: Array<{ ano: number; mes: number }> = [];
    const cur = new Date(de.getFullYear(), de.getMonth(), 1);
    const fim = new Date(ate.getFullYear(), ate.getMonth(), 1);
    while (cur <= fim) {
      meses.push({ ano: cur.getFullYear(), mes: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }

    // Sprint 1: Comissao agora tem empresaId direto. Usa direto.
    const whereBase: Prisma.ComissaoWhereInput = {
      empresaId,
      OR: meses.map((m) => ({ ano: m.ano, mes: m.mes })),
      ...(rf !== undefined ? { representanteId: rf as Prisma.StringFilter } : {}),
    };

    const [aggrTotal, porTipo, registros] = await Promise.all([
      this.prisma.comissao.aggregate({
        where: whereBase,
        _sum: { totalComissao: true, totalVendas: true, qtdPedidos: true },
        _count: { _all: true },
      }),
      this.prisma.comissao.groupBy({
        by: ['tipo'],
        where: whereBase,
        _sum: { totalComissao: true },
        _count: { _all: true },
      }),
      this.prisma.comissao.findMany({
        where: whereBase,
        select: {
          representanteId: true,
          tipo: true,
          ano: true,
          mes: true,
          totalVendas: true,
          totalComissao: true,
          qtdPedidos: true,
          pago: true,
          percentual: true,
        },
        orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
      }),
    ]);

    const repIds = [...new Set(registros.map((r) => r.representanteId))];
    const nomes = await this.nomesReps(repIds);

    const pagos = registros.filter((r) => r.pago).reduce((s, r) => s + r.totalComissao, 0);
    const aPagar = registros.filter((r) => !r.pago).reduce((s, r) => s + r.totalComissao, 0);

    return {
      periodo: { de, ate },
      totalComissao: arredondar(aggrTotal._sum.totalComissao),
      totalVendas: arredondar(aggrTotal._sum.totalVendas),
      pago: arredondar(pagos),
      aPagar: arredondar(aPagar),
      porTipo: porTipo.map((t) => ({
        tipo: t.tipo,
        total: arredondar(t._sum.totalComissao),
        count: t._count._all,
      })),
      detalhes: registros.map((r) => ({
        representanteId: r.representanteId,
        representanteNome: nomes.get(r.representanteId) ?? 'Desconhecido',
        tipo: r.tipo,
        ano: r.ano,
        mes: r.mes,
        totalVendas: arredondar(r.totalVendas),
        totalComissao: arredondar(r.totalComissao),
        qtdPedidos: r.qtdPedidos,
        pago: r.pago,
        percentual: r.percentual,
      })),
    };
  }

  // ─── 4. SAC / Ocorrências ─────────────────────────────────────────────

  async sac(user: AuthenticatedUser, params: PeriodoDto) {
    const empresaId = this.requireEmpresa(user);
    const rf = await this.repFilter(user, params.representanteId);
    const { de, ate } = params;
    const prev = periodoAnterior(de, ate);
    const agora = new Date();

    // AUDITORIA P0-5: aplica scope via cliente.representanteId
    // Ocorrências não têm representanteId direto — via cliente.
    const baseWhere = (inicio: Date, fim: Date): Prisma.OcorrenciaWhereInput => {
      const w: Prisma.OcorrenciaWhereInput = {
        empresaId,
        criadoEm: { gte: inicio, lte: fim },
      };
      if (rf !== undefined) {
        w.cliente = { representanteId: rf };
      }
      return w;
    };

    const [
      aggrAtual,
      aggrAnterior,
      porStatus,
      porSeveridade,
      porTipo,
      slaEstourado,
      resolvidasComTempo,
    ] = await Promise.all([
      this.prisma.ocorrencia.count({ where: baseWhere(de, ate) }),
      this.prisma.ocorrencia.count({ where: baseWhere(prev.de, prev.ate) }),
      this.prisma.ocorrencia.groupBy({
        by: ['status'],
        where: baseWhere(de, ate),
        _count: { _all: true },
      }),
      this.prisma.ocorrencia.groupBy({
        by: ['severidade'],
        where: baseWhere(de, ate),
        _count: { _all: true },
      }),
      this.prisma.ocorrencia.groupBy({
        by: ['tipo'],
        where: baseWhere(de, ate),
        _count: { _all: true },
      }),
      this.prisma.ocorrencia.count({
        where: {
          ...baseWhere(de, ate),
          slaVenceEm: { lt: agora },
          status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
        },
      }),
      // Para calcular TMR (tempo médio de resolução)
      this.prisma.ocorrencia.findMany({
        where: {
          ...baseWhere(de, ate),
          status: 'RESOLVIDA',
          resolvidoEm: { gte: de, lte: ate },
        },
        select: { criadoEm: true, resolvidoEm: true },
      }),
    ]);

    // Tempo médio de resolução em horas
    let tmrHoras = 0;
    if (resolvidasComTempo.length > 0) {
      const somaMs = resolvidasComTempo.reduce((s, o) => {
        const resolvido = o.resolvidoEm?.getTime() ?? o.criadoEm.getTime();
        return s + (resolvido - o.criadoEm.getTime());
      }, 0);
      tmrHoras = Math.round(somaMs / resolvidasComTempo.length / (1000 * 60 * 60));
    }

    const porStatusMap: Record<string, number> = {};
    for (const s of porStatus) porStatusMap[s.status] = s._count._all;

    return {
      periodo: { de, ate },
      total: {
        atual: aggrAtual,
        anterior: aggrAnterior,
        variacao: variacao(aggrAtual, aggrAnterior),
      },
      slaEstourado,
      tmrHoras,
      abertas: porStatusMap['ABERTA'] ?? 0,
      emAndamento: porStatusMap['EM_ANDAMENTO'] ?? 0,
      resolvidas: porStatusMap['RESOLVIDA'] ?? 0,
      canceladas: porStatusMap['CANCELADA'] ?? 0,
      porSeveridade: porSeveridade.map((s) => ({
        severidade: s.severidade,
        count: s._count._all,
      })),
      porTipo: porTipo.map((t) => ({
        tipo: t.tipo,
        count: t._count._all,
      })),
    };
  }

  // ─── 5. Campanhas ─────────────────────────────────────────────────────

  async campanhas(user: AuthenticatedUser, params: PeriodoDto) {
    const empresaId = this.requireEmpresa(user);
    const { de, ate } = params;

    // AUDITORIA P0-5: REP só vê campanhas que criou
    // (alinhado com CampanhasService.baseWhere)
    const where: Prisma.CampanhaWhereInput = {
      empresaId,
      criadoEm: { gte: de, lte: ate },
    };
    if (user.role === 'REP') {
      where.criadoPorId = user.id;
    }

    const [campanhasList, porCanal, porStatus] = await Promise.all([
      this.prisma.campanha.findMany({
        where,
        select: {
          id: true,
          nome: true,
          canal: true,
          status: true,
          criadoEm: true,
          _count: { select: { destinatarios: true } },
        },
        orderBy: { criadoEm: 'desc' },
        take: 20,
      }),
      this.prisma.campanha.groupBy({
        by: ['canal'],
        where,
        _count: { _all: true },
      }),
      this.prisma.campanha.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);

    // Métricas de destinatários agregadas
    const campanhaIds = campanhasList.map((c) => c.id);
    const destGrp = campanhaIds.length > 0
      ? await this.prisma.campanhaDestinatario.groupBy({
          by: ['campanhaId', 'status'],
          where: { campanhaId: { in: campanhaIds } },
          _count: { _all: true },
        })
      : [];

    const destPorCampanha: Record<string, Record<string, number>> = {};
    for (const d of destGrp) {
      if (!destPorCampanha[d.campanhaId]) destPorCampanha[d.campanhaId] = {};
      destPorCampanha[d.campanhaId][d.status] = d._count._all;
    }

    const totalEnviados = destGrp
      .filter((d) => d.status === 'ENVIADO' || d.status === 'LIDO')
      .reduce((s, d) => s + d._count._all, 0);
    const totalLidos = destGrp
      .filter((d) => d.status === 'LIDO')
      .reduce((s, d) => s + d._count._all, 0);
    const totalDestinatarios = destGrp.reduce((s, d) => s + d._count._all, 0);

    return {
      periodo: { de, ate },
      totalCampanhas: campanhasList.length,
      totalDestinatarios,
      taxaEnvio: totalDestinatarios > 0
        ? Math.round((totalEnviados / totalDestinatarios) * 100)
        : 0,
      taxaLeitura: totalEnviados > 0
        ? Math.round((totalLidos / totalEnviados) * 100)
        : 0,
      porCanal: porCanal.map((c) => ({ canal: c.canal, count: c._count._all })),
      porStatus: porStatus.map((s) => ({ status: s.status, count: s._count._all })),
      campanhas: campanhasList.map((c) => {
        const dest = destPorCampanha[c.id] ?? {};
        const total = Object.values(dest).reduce((s, n) => s + n, 0);
        const enviados = (dest['ENVIADO'] ?? 0) + (dest['LIDO'] ?? 0);
        const lidos = dest['LIDO'] ?? 0;
        return {
          id: c.id,
          nome: c.nome,
          canal: c.canal,
          status: c.status,
          criadoEm: c.criadoEm,
          totalDestinatarios: total,
          enviados,
          lidos,
          taxaEnvio: total > 0 ? Math.round((enviados / total) * 100) : 0,
          taxaLeitura: enviados > 0 ? Math.round((lidos / enviados) * 100) : 0,
        };
      }),
    };
  }

  // ─── 6. Amostras ──────────────────────────────────────────────────────

  async amostras(user: AuthenticatedUser, params: PeriodoDto) {
    const empresaId = this.requireEmpresa(user);
    const rf = await this.repFilter(user, params.representanteId);
    const { de, ate } = params;
    const prev = periodoAnterior(de, ate);

    // AUDITORIA P0-5: aplica scope via cliente.representanteId
    const where = (inicio: Date, fim: Date): Prisma.AmostraWhereInput => {
      const w: Prisma.AmostraWhereInput = {
        empresaId,
        enviadoEm: { gte: inicio, lte: fim },
      };
      if (rf !== undefined) {
        w.cliente = { representanteId: rf };
      }
      return w;
    };

    type AmostraGrpRow = { status: string; _count: { _all: number }; _sum: { valor: number | null } | null };
    const [porStatusAgg, totalAtual, totalAnterior] = await Promise.all([
      this.prisma.amostra.groupBy({
        by: ['status'],
        where: where(de, ate),
        _count: { _all: true },
        _sum: { valor: true },
      }) as unknown as Promise<AmostraGrpRow[]>,
      this.prisma.amostra.count({ where: where(de, ate) }),
      this.prisma.amostra.count({ where: where(prev.de, prev.ate) }),
    ]);

    const byStatus: Record<string, { count: number; valor: number }> = {};
    for (const s of porStatusAgg) {
      byStatus[s.status] = {
        count: s._count._all,
        valor: arredondar(s._sum?.valor),
      };
    }

    const enviadas = byStatus['ENVIADA']?.count ?? 0;
    const convertidas = byStatus['CONVERTIDA']?.count ?? 0;
    const expiradas = byStatus['EXPIRADA']?.count ?? 0;

    return {
      periodo: { de, ate },
      total: {
        atual: totalAtual,
        anterior: totalAnterior,
        variacao: variacao(totalAtual, totalAnterior),
      },
      enviadas,
      convertidas,
      expiradas,
      taxaConversao: enviadas > 0 ? Math.round((convertidas / enviadas) * 100) : 0,
      valorTotal: arredondar(porStatusAgg.reduce((s, p) => s + (p._sum?.valor ?? 0), 0) as number),
      valorConvertido: arredondar(byStatus['CONVERTIDA']?.valor ?? 0),
      porStatus: porStatusAgg.map((s) => ({
        status: s.status,
        count: s._count._all,
        valor: arredondar(s._sum?.valor),
      })),
    };
  }

  // ─── 7. Dashboard executivo ───────────────────────────────────────────

  async dashboard(user: AuthenticatedUser, params: PeriodoDto) {
    const [vendasData, funilData, sacData, campanhasData, amostrasData] = await Promise.all([
      this.vendas(user, params),
      this.funil(user, params),
      this.sac(user, params),
      this.campanhas(user, params),
      this.amostras(user, params),
    ]);

    return {
      periodo: { de: params.de, ate: params.ate },
      vendas: {
        faturamento: vendasData.faturamento,
        receitaRealizada: vendasData.receitaRealizada,
        totalPedidos: vendasData.totalPedidos,
        ticketMedio: vendasData.ticketMedio,
      },
      funil: {
        totalAtivos: funilData.totalAtivos,
        criados: funilData.criados,
        ganhos: funilData.ganhos,
        taxaConversao: funilData.taxaConversao,
      },
      sac: {
        total: sacData.total,
        abertas: sacData.abertas,
        slaEstourado: sacData.slaEstourado,
        tmrHoras: sacData.tmrHoras,
      },
      campanhas: {
        totalCampanhas: campanhasData.totalCampanhas,
        totalDestinatarios: campanhasData.totalDestinatarios,
        taxaEnvio: campanhasData.taxaEnvio,
        taxaLeitura: campanhasData.taxaLeitura,
      },
      amostras: {
        total: amostrasData.total,
        taxaConversao: amostrasData.taxaConversao,
        valorConvertido: amostrasData.valorConvertido,
      },
    };
  }
}
