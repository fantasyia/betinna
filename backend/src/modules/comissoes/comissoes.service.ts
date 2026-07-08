import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import { addBreadcrumb } from '@shared/observability/sentry';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import { empresaFilter, getCallerEmpresaId, isGlobalAdmin } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import {
  type ComissaoBonusConfig,
  faixaPercentual,
  resolveComissaoBonus,
} from './comissao-faixas.util';
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

// % de comissão do REP quando o usuário não tem `comissaoPadrao` configurada (mesmo default do
// pedido — pedido-pricing.service usa 5). CAÇADA-BUG #5.
const COMISSAO_PADRAO_FALLBACK_PCT = 5;

@Injectable()
export class ComissoesService {
  private readonly logger = new Logger(ComissoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    private readonly notificacoes: NotificacoesService,
    private readonly email: TransactionalEmailService,
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
    // CAÇADA-BUG #22: a janela do mês é no fuso do tenant (BRT, UTC-3), não em UTC. Meia-noite BRT do
    // dia 1 = 03:00 UTC. Antes usava Date.UTC(ano, mes-1, 1) = 00:00 UTC = 21:00 BRT da VÉSPERA → um
    // pedido enviado ao OMIE em 30/06 22h BRT (01/07 01h UTC) caía na comissão de JULHO em vez de
    // JUNHO. O offset +3h alinha a janela ao mês-calendário BRT (Brasil sem DST desde 2019).
    const OFFSET_BRT_H = 3;
    const inicio = new Date(Date.UTC(dto.ano, dto.mes - 1, 1, OFFSET_BRT_H));
    const fim = new Date(Date.UTC(dto.ano, dto.mes, 1, OFFSET_BRT_H));

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
      // Estorno de devolução APROVADA (líquido): subtrai comissaoEstornada/valorDevolvido.
      _sum: { total: true, comissao: true, comissaoEstornada: true, valorDevolvido: true },
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
    // Quais (rep,tipo) já têm comissão neste mês. Com reprocessar=false o upsert desses vira
    // no-op (update={}) — então NÃO acumulamos seus totais nem notificamos por eles. Senão um
    // re-run do cron mensal anunciava números completos (e-mail/notificação) sem mexer na folha.
    const jaExistentes = dto.reprocessar
      ? new Set<string>()
      : new Set(
          (
            await this.prisma.comissao.findMany({
              where: { empresaId, ano: dto.ano, mes: dto.mes },
              select: { representanteId: true, tipo: true },
            })
          ).map((c) => `${c.representanteId}:${c.tipo}`),
        );
    let registrosNovos = 0;

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

    // Comissão escalonada por faturamento (Empresa.config.comissaoBonus).
    // modelo 'fixa' (default) = soma do `comissao` pré-calculado por pedido (atual).
    const empresaCfg = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const comissaoCfg: ComissaoBonusConfig = resolveComissaoBonus(
      (empresaCfg?.config as { comissaoBonus?: unknown } | null)?.comissaoBonus,
    );

    const agora = new Date();

    // Monta os upserts de REP e de GERENTE e executa TUDO numa única transação no fim —
    // antes eram 2 $transaction separadas, então uma falha na 2ª deixava as comissões de
    // REP gravadas sem as de GERENTE (estado parcial da folha).
    const repOps = aggregated
      .filter(
        (row): row is typeof row & { representanteId: string } => row.representanteId !== null,
      )
      .map((row) => {
        // #17 — _sum do Pedido vem Decimal; converte pra number. LÍQUIDO de devolução
        // aprovada: vendas − valorDevolvido, comissão − comissaoEstornada (nunca < 0).
        const totalVendas = Math.max(
          0,
          Number(row._sum.total ?? 0) - Number(row._sum.valorDevolvido ?? 0),
        );
        // CAÇADA-BUG #5: comissão REP = faturamento LÍQUIDO × % efetivo.
        //  - Escalonada: % da faixa por faturamento.
        //  - Fixa (default): comissaoPadrao do rep (D46), fallback 5%.
        // Antes a fixa somava `pedido.comissao` (gravado com 5% HARDCODED no create), ignorando a
        // comissaoPadrao configurada → rep de 8% recebia 5% e o snapshot `percentual` (que já usava
        // comissaoPadrao) contradizia o valor pago. Como `totalVendas` já é líquido de devolução,
        // multiplicar pelo pct cobre o estorno na % correta (não precisa subtrair comissaoEstornada,
        // que também estava a 5%).
        const escalonada = comissaoCfg.modelo === 'escalonada_por_faturamento';
        const pctRep = escalonada
          ? faixaPercentual(comissaoCfg.faixas, totalVendas)
          : (pctPorRep.get(row.representanteId) ?? COMISSAO_PADRAO_FALLBACK_PCT);
        const totalComissao = Math.round(totalVendas * ((pctRep ?? 0) / 100) * 100) / 100;
        // Só acumula/conta como novo quando o registro será de fato gravado (não no-op).
        if (!jaExistentes.has(`${row.representanteId}:REP`)) {
          totalVendasAgg += totalVendas;
          totalComissaoAgg += totalComissao;
          registrosNovos += 1;
        }
        return this.prisma.comissao.upsert({
          where: {
            empresaId_representanteId_tipo_ano_mes: {
              empresaId,
              representanteId: row.representanteId,
              tipo: 'REP',
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
      });

    // Comissão dos GERENTES: total de vendas dos REPs sob sua gerência × % do gerente.
    const reps = await this.prisma.usuario.findMany({
      where: { id: { in: repIds }, role: 'REP' },
      select: { id: true, gerenteId: true },
    });
    const vendasPorRep = new Map<string, number>();
    for (const row of aggregated) {
      if (row.representanteId) {
        // #17 — Decimal→number, LÍQUIDO de devolução (mesma base do rep).
        vendasPorRep.set(
          row.representanteId,
          Math.max(0, Number(row._sum.total ?? 0) - Number(row._sum.valorDevolvido ?? 0)),
        );
      }
    }
    const vendasPorGerente = new Map<string, number>();
    for (const r of reps) {
      if (!r.gerenteId) continue;
      const v = vendasPorRep.get(r.id) ?? 0;
      vendasPorGerente.set(r.gerenteId, (vendasPorGerente.get(r.gerenteId) ?? 0) + v);
    }

    let gerentesProcessados = 0;
    let gerenteOps: typeof repOps = [];
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

      gerenteOps = gerentes.map((g) => {
        const totalVendas = vendasPorGerente.get(g.id) ?? 0;
        // Snapshot: se já existe percentual salvo, usa ele; senão pega o atual
        const pctSalvo = pctSalvoPorGerente.get(g.id);
        const pct = pctSalvo ?? g.comissaoPadrao ?? 0;
        const totalComissao = Math.round(totalVendas * (pct / 100) * 100) / 100;
        gerentesProcessados += 1;
        return this.prisma.comissao.upsert({
          where: {
            empresaId_representanteId_tipo_ano_mes: {
              empresaId,
              representanteId: g.id,
              tipo: 'GERENTE',
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
      });
      // Soma usando o pct snapshotado — só dos gerentes que serão de fato gravados (não no-op).
      totalComissaoAgg += gerentes.reduce((sum, g) => {
        if (jaExistentes.has(`${g.id}:GERENTE`)) return sum;
        registrosNovos += 1;
        const v = vendasPorGerente.get(g.id) ?? 0;
        const pctSalvo = pctSalvoPorGerente.get(g.id);
        const pct = pctSalvo ?? g.comissaoPadrao ?? 0;
        return sum + Math.round(v * (pct / 100) * 100) / 100;
      }, 0);
    }

    // Atômico: comissões de REP + GERENTE gravadas juntas (tudo-ou-nada).
    await this.prisma.$transaction([...repOps, ...gerenteOps]);

    addBreadcrumb('comissoes', 'fechamento-completo', {
      empresaId,
      mes: dto.mes,
      ano: dto.ano,
      reps: aggregated.length,
      gerentes: gerentesProcessados,
      totalVendas: totalVendasAgg,
      totalComissao: totalComissaoAgg,
    });

    this.logger.log(
      `Fechamento ${dto.mes}/${dto.ano} (empresa ${empresaId}): ${aggregated.length} reps + ${gerentesProcessados} gerentes · R$${totalVendasAgg.toFixed(2)} vendas · R$${totalComissaoAgg.toFixed(2)} comissão`,
    );

    // Notifica/e-mail SÓ quando houve gravação real (registro novo) ou reprocessamento — senão
    // um re-run do cron mensal num mês já fechado dispararia COMISSAO_FECHADA indevidamente.
    if (registrosNovos > 0 || dto.reprocessar) {
      void this.notificacoes.criarParaRole({
        empresaId,
        roles: ['REP', 'GERENTE'],
        tipo: 'COMISSAO_FECHADA',
        prioridade: 'NORMAL',
        titulo: `Comissão ${dto.mes}/${dto.ano} fechada`,
        mensagem: `Mês fechou com R$${totalVendasAgg.toFixed(2)} em vendas. Confira sua linha em /comissoes.`,
        link: '/comissoes',
        metadata: { ano: dto.ano, mes: dto.mes },
      });

      // E-mail transacional personalizado por rep (busca os valores individuais)
      void this.notificarEmailFechamento(empresaId, dto.mes, dto.ano);
    }

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
    const result = await this.findById(user, id);
    // Notifica o REP/GERENTE que sua comissão foi paga
    void this.notificacoes.criarParaUsuario({
      empresaId: result.empresaId,
      usuarioId: result.representanteId,
      tipo: 'COMISSAO_PAGA',
      prioridade: 'NORMAL',
      titulo: 'Comissão paga',
      mensagem: `Comissão de ${result.mes}/${result.ano} (R$ ${result.totalComissao.toFixed(2)}) marcada como paga.`,
      link: '/comissoes',
      metadata: { comissaoId: result.id, ano: result.ano, mes: result.mes },
    });
    return result;
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
    const [historico, registrosDoAno] = await Promise.all([
      // Histórico EXIBIDO: os 12 lançamentos mais recentes.
      this.prisma.comissao.findMany({
        where: {
          representanteId: repId,
          ...this.tenantFilter(user),
        },
        orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
        take: 12,
        include: comissaoInclude,
      }),
      // CAÇADA-BUG #26: os TOTAIS anuais precisam de TODOS os lançamentos do ano. Um usuário com
      // linhas REP + GERENTE no mesmo mês (2/mês) tem até 24/ano — o `take: 12` cobria só ~6 meses e
      // o "recebido no ano" saía subreportado ~pela metade. Query separada escopada ao ano, sem take.
      this.prisma.comissao.findMany({
        where: {
          representanteId: repId,
          ano,
          ...this.tenantFilter(user),
        },
        select: { totalComissao: true, pago: true },
      }),
    ]);
    const totalRecebido = registrosDoAno
      .filter((c) => c.pago)
      .reduce((s, c) => s + Number(c.totalComissao), 0);
    const totalAReceber = registrosDoAno
      .filter((c) => !c.pago)
      .reduce((s, c) => s + Number(c.totalComissao), 0);
    return {
      representanteId: repId,
      anoAtual: ano,
      totalRecebidoAnoAtual: totalRecebido,
      totalAReceberAnoAtual: totalAReceber,
      historico,
    };
  }

  /**
   * Best-effort: pra cada rep com comissão fechada do mês, manda e-mail
   * personalizado com seus números individuais. Loop por rep — uma falha
   * não bloqueia os outros.
   */
  private async notificarEmailFechamento(
    empresaId: string,
    mes: number,
    ano: number,
  ): Promise<void> {
    try {
      const comissoes = await this.prisma.comissao.findMany({
        where: { empresaId, mes, ano },
        select: {
          totalVendas: true,
          totalComissao: true,
          representante: { select: { email: true, nome: true, status: true } },
        },
      });
      for (const c of comissoes) {
        if (!c.representante?.email || c.representante.status !== 'ATIVO') continue;
        void this.email.enviarComissaoFechada({
          para: c.representante.email,
          repNome: c.representante.nome,
          mes,
          ano,
          totalVendas: Number(c.totalVendas),
          totalComissao: Number(c.totalComissao),
        });
      }
    } catch (err) {
      this.logger.warn(
        `Falha enviando e-mails de fechamento: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
