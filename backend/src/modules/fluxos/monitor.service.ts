import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BotCustoService } from '@modules/mullerbot/bot-custo.service';
import { CAMPANHA_ENVIO_QUEUE } from '@modules/campanhas/campanha-envio.types';
import { DEAD_LETTER_QUEUE } from '@modules/dead-letter/dead-letter.types';
import { FLUXO_QUEUE } from './fluxo-executor.types';

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

export interface FilaCampanha {
  id: string;
  nome: string;
  canal: string;
  status: string;
  pendentes: number;
  enviados: number;
  erros: number;
}
export interface FilaEnvios {
  /** Campanhas com destinatários ainda PENDENTES (empresa ativa). */
  campanhas: FilaCampanha[];
  /** Totais de pendências por canal (empresa ativa). */
  totais: { whatsappPendentes: number; emailPendentes: number };
  /**
   * Contadores das filas técnicas BullMQ — GLOBAIS da plataforma (não por
   * empresa), por isso só preenchidos pra ADMIN. null pros demais papéis.
   */
  sistema: {
    fluxo: { aguardando: number; agendados: number; executando: number; falhas: number };
    campanhaEnvio: { aguardando: number; agendados: number; executando: number; falhas: number };
    deadLetter: number;
  } | null;
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
    @InjectQueue(FLUXO_QUEUE) private readonly fluxoQueue: Queue,
    @InjectQueue(CAMPANHA_ENVIO_QUEUE) private readonly campanhaQueue: Queue,
    @InjectQueue(DEAD_LETTER_QUEUE) private readonly deadLetterQueue: Queue,
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

  /**
   * Fila de envios — quanto ainda falta disparar (campanhas e-mail/WhatsApp da
   * empresa) + contadores das filas técnicas BullMQ (ADMIN only, são globais).
   */
  async filas(user: AuthenticatedUser): Promise<FilaEnvios> {
    const empresaId = this.requireEmpresa(user);

    // Campanhas "vivas" (podem ainda ter pendência) + contagem por status.
    const campanhas = await this.prisma.campanha.findMany({
      where: { empresaId, status: { in: ['AGENDADA', 'ENVIANDO', 'PAUSADA'] } },
      orderBy: { criadoEm: 'desc' },
      select: { id: true, nome: true, canal: true, status: true },
      take: 50,
    });

    let porCampanha = new Map<string, Record<string, number>>();
    if (campanhas.length > 0) {
      const grp = await this.prisma.campanhaDestinatario.groupBy({
        by: ['campanhaId', 'status'],
        where: { campanhaId: { in: campanhas.map((c) => c.id) } },
        _count: { _all: true },
      });
      porCampanha = grp.reduce((m, g) => {
        const linha = m.get(g.campanhaId) ?? {};
        linha[g.status] = g._count._all;
        m.set(g.campanhaId, linha);
        return m;
      }, porCampanha);
    }

    const lista: FilaCampanha[] = campanhas.map((c) => {
      const s = porCampanha.get(c.id) ?? {};
      return {
        id: c.id,
        nome: c.nome,
        canal: c.canal,
        status: c.status,
        pendentes: s['PENDENTE'] ?? 0,
        enviados: (s['ENVIADO'] ?? 0) + (s['LIDO'] ?? 0),
        erros: s['ERRO'] ?? 0,
      };
    });

    // Totais por canal: WHATSAPP_EMAIL conta nos dois (dispara nos dois canais).
    const totais = lista.reduce(
      (t, c) => {
        if (c.canal === 'WHATSAPP' || c.canal === 'WHATSAPP_EMAIL') {
          t.whatsappPendentes += c.pendentes;
        }
        if (c.canal === 'EMAIL' || c.canal === 'WHATSAPP_EMAIL') {
          t.emailPendentes += c.pendentes;
        }
        return t;
      },
      { whatsappPendentes: 0, emailPendentes: 0 },
    );

    // Filas técnicas: contadores globais da plataforma → só ADMIN vê.
    let sistema: FilaEnvios['sistema'] = null;
    if (user.role === 'ADMIN') {
      const [fx, ce, dl] = await Promise.all([
        this.fluxoQueue.getJobCounts('waiting', 'delayed', 'active', 'failed'),
        this.campanhaQueue.getJobCounts('waiting', 'delayed', 'active', 'failed'),
        this.deadLetterQueue.getJobCounts('waiting'),
      ]);
      sistema = {
        fluxo: {
          aguardando: fx.waiting ?? 0,
          agendados: fx.delayed ?? 0,
          executando: fx.active ?? 0,
          falhas: fx.failed ?? 0,
        },
        campanhaEnvio: {
          aguardando: ce.waiting ?? 0,
          agendados: ce.delayed ?? 0,
          executando: ce.active ?? 0,
          falhas: ce.failed ?? 0,
        },
        deadLetter: dl.waiting ?? 0,
      };
    }

    return { campanhas: lista.filter((c) => c.pendentes > 0 || c.erros > 0), totais, sistema };
  }
}
