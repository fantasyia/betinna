import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BotCustoService } from '@modules/mullerbot/bot-custo.service';

export interface MonitorEtapa {
  id: string;
  nome: string;
  cor: string;
  tipo: string;
  leads: number;
  slaDias: number | null;
  /** Tempo médio (dias) que os leads estão parados nesta etapa (Fase C). */
  tempoMedioDias: number;
}
export interface MonitorFunil {
  id: string;
  nome: string;
  cor: string;
  total: number;
  etapas: MonitorEtapa[];
}
export interface MonitorResumo {
  funis: MonitorFunil[];
  iaAtivas: number;
  slaVencidos: number;
  fluxosAtivos: number;
  execucoes: { total: number; concluidas: number; falhas: number; aguardando: number };
  /** Execuções de fluxo criadas hoje (Fase C — spec §2.8). */
  disparosHoje: number;
  /** Custo OpenAI da empresa (tokens dia/mês) — reaproveita o teto de custo. */
  custoOpenAi: Awaited<ReturnType<BotCustoService['statusCusto']>>;
}

/**
 * MonitorService (orquestração Fase B) — painel de saúde do funil:
 * leads por etapa/funil, conversas de IA ativas, SLAs vencidos e execuções.
 */
@Injectable()
export class MonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly custo: BotCustoService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = getCallerEmpresaId(user);
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  async resumo(user: AuthenticatedUser): Promise<MonitorResumo> {
    const empresaId = this.requireEmpresa(user);

    const funis = await this.prisma.funil.findMany({
      where: { empresaId, ativo: true },
      orderBy: { ordem: 'asc' },
      select: {
        id: true,
        nome: true,
        cor: true,
        etapas: {
          orderBy: { ordem: 'asc' },
          select: { id: true, nome: true, cor: true, tipo: true, slaDias: true, slaHoras: true },
        },
      },
    });

    // Contagem de leads por etapa (1 query).
    const counts = await this.prisma.lead.groupBy({
      by: ['funilEtapaId'],
      where: { empresaId, funilEtapaId: { not: null } },
      _count: { _all: true },
    });
    const countMap = new Map<string, number>();
    for (const c of counts) {
      if (c.funilEtapaId) countMap.set(c.funilEtapaId, c._count._all);
    }

    // Tempo médio (dias) parado por etapa (Fase C — spec §2.8).
    const idades = await this.prisma.$queryRaw<Array<{ funilEtapaId: string; mediaSeg: number }>>`
      SELECT "funilEtapaId", AVG(EXTRACT(EPOCH FROM (now() - "etapaDesde"))) AS "mediaSeg"
      FROM "Lead"
      WHERE "empresaId" = ${empresaId} AND "funilEtapaId" IS NOT NULL
      GROUP BY "funilEtapaId"`;
    const idadeMap = new Map<string, number>();
    for (const r of idades) idadeMap.set(r.funilEtapaId, Math.round(Number(r.mediaSeg) / 86400));

    const funisResumo: MonitorFunil[] = funis.map((f) => {
      const etapas: MonitorEtapa[] = f.etapas.map((e) => ({
        id: e.id,
        nome: e.nome,
        cor: e.cor,
        tipo: e.tipo,
        slaDias: e.slaDias,
        leads: countMap.get(e.id) ?? 0,
        tempoMedioDias: idadeMap.get(e.id) ?? 0,
      }));
      return {
        id: f.id,
        nome: f.nome,
        cor: f.cor,
        etapas,
        total: etapas.reduce((s, e) => s + e.leads, 0),
      };
    });

    // SLAs vencidos: leads que passaram do prazo na etapa atual (etapas com slaDias).
    const etapasComSla = funis.flatMap((f) =>
      f.etapas.filter((e) => e.slaDias != null || e.slaHoras != null),
    );
    let slaVencidos = 0;
    for (const e of etapasComSla) {
      const corte = new Date();
      if (e.slaHoras) corte.setHours(corte.getHours() - e.slaHoras);
      else corte.setDate(corte.getDate() - (e.slaDias as number));
      slaVencidos += await this.prisma.lead.count({
        where: { empresaId, funilEtapaId: e.id, etapaDesde: { lt: corte } },
      });
    }

    const [iaAtivas, fluxosAtivos, total, concluidas, falhas, aguardando] = await Promise.all([
      this.prisma.fluxoExecucao.count({ where: { empresaId, status: 'AGUARDANDO' } }),
      this.prisma.fluxo.count({ where: { empresaId, status: 'ATIVO' } }),
      this.prisma.fluxoExecucao.count({ where: { empresaId } }),
      this.prisma.fluxoExecucao.count({ where: { empresaId, status: 'CONCLUIDO' } }),
      this.prisma.fluxoExecucao.count({ where: { empresaId, status: 'FALHOU' } }),
      this.prisma.fluxoExecucao.count({
        where: { empresaId, status: { in: ['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO'] } },
      }),
    ]);

    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);
    const [disparosHoje, custoOpenAi] = await Promise.all([
      this.prisma.fluxoExecucao.count({ where: { empresaId, criadoEm: { gte: inicioHoje } } }),
      this.custo.statusCusto(empresaId),
    ]);

    return {
      funis: funisResumo,
      iaAtivas,
      slaVencidos,
      fluxosAtivos,
      execucoes: { total, concluidas, falhas, aguardando },
      disparosHoje,
      custoOpenAi,
    };
  }
}
