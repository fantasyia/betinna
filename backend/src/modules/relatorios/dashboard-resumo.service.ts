import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { proximaExecucaoCrons } from '@modules/fluxos/cron.util';

const DIA_MS = 24 * 60 * 60 * 1000;
const TZ_PADRAO = 'America/Sao_Paulo';

/** Uma linha da fila "Precisa de você" (M2) — sempre com o PORQUÊ e uma ação. */
export interface TriagemItem {
  tipo: 'sla' | 'parado' | 'fluxo_falha' | 'card_atrasado' | 'nutrir';
  titulo: string;
  /** Por que está aqui — legível, direto ("SLA de 3d estourado há 2d"). */
  motivo: string;
  /** Desde quando (ISO) — o front mostra "há X". */
  desde: string | null;
  /** Rota do front pra 1 clique resolver. */
  link: string;
  /** Peso de ordenação: maior = mais urgente (topo da fila). */
  urgencia: number;
}

/**
 * Agregação do dashboard-cockpit (M1 pulso + M2 triagem + prontidão + M6 sala
 * de fluxos) em UMA chamada — o front não pode fazer N requisições pra montar
 * a tela. Tudo agregado aqui no backend (SQL/Prisma), nunca no cliente.
 *
 * Escopo por papel: leads respeitam a carteira (RepScope). Os módulos de GESTÃO
 * (fluxos, quadros do Diretor, 📥 Nutrir) só vêm pra ADMIN/DIRECTOR/GERENTE —
 * pro REP eles voltam vazios em vez de vazar visão da empresa.
 */
@Injectable()
export class DashboardResumoService {
  private readonly logger = new Logger(DashboardResumoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  async resumo(user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    const scope = await this.repScope.getRepIds(user);
    const ehGestao = user.role !== 'REP';
    const agora = new Date();

    // Filtro de carteira pros LEADS (rep vê só o dele; gestão vê tudo).
    const repFilter: Prisma.LeadWhereInput =
      scope !== null ? { representanteId: { in: scope.length ? scope : ['__none__'] } } : {};

    // Funis de TRIAGEM ficam fora das contagens comerciais (mesma regra da home).
    const triagemIds = (
      await this.prisma.funil.findMany({
        where: { empresaId, triagem: true },
        select: { id: true },
      })
    ).map((f) => f.id);
    const foraDaTriagem: Prisma.LeadWhereInput = triagemIds.length
      ? { OR: [{ funilId: null }, { funilId: { notIn: triagemIds } }] }
      : {};

    const [
      leadsNovos7d,
      slaRows,
      paradoRows,
      fluxosPorStatus,
      exec24h,
      falhas7d,
      tarefasHoje,
      etapasSlaSemAcao,
      funisComContagem,
      whatsappInstancias,
      fluxosLista,
      exec7dPorFluxo,
    ] = await Promise.all([
      // Pulso: leads novos nos últimos 7 dias (comercial — triagem fora).
      this.prisma.lead.count({
        where: {
          empresaId,
          criadoEm: { gte: new Date(agora.getTime() - 7 * DIA_MS) },
          ...repFilter,
          ...foraDaTriagem,
        },
      }),
      // SLA estourado: lead em etapa ATIVA cujo slaDias/slaHoras já venceu desde
      // etapaDesde. O SLA já está MODELADO no banco (Clientes: 3/5/7/10 dias) —
      // este é o primeiro lugar que o usa de verdade.
      this.prisma.$queryRaw<
        Array<{
          id: string;
          nome: string;
          etapaNome: string;
          etapaDesde: Date;
          slaDias: number | null;
          slaHoras: number | null;
        }>
      >`
        SELECT l."id", l."nome", fe."nome" AS "etapaNome", l."etapaDesde",
               fe."slaDias", fe."slaHoras"
        FROM "Lead" l
        JOIN "FunilEtapa" fe ON fe."id" = l."funilEtapaId"
        WHERE l."empresaId" = ${empresaId}
          AND fe."tipo" = 'ATIVA'
          AND (fe."slaDias" IS NOT NULL OR fe."slaHoras" IS NOT NULL)
          AND l."etapaDesde" +
              (COALESCE(fe."slaDias", 0) * INTERVAL '1 day') +
              (COALESCE(fe."slaHoras", 0) * INTERVAL '1 hour') < NOW()
          ${scope !== null ? Prisma.sql`AND l."representanteId" = ANY(${scope.length ? scope : ['__none__']})` : Prisma.empty}
        ORDER BY l."etapaDesde" ASC
        LIMIT 20
      `,
      // Mais parados: top leads em etapa ativa há mais tempo (sem SLA definido
      // também contam — parado é parado).
      this.prisma.lead.findMany({
        where: {
          empresaId,
          etapa: { notIn: ['GANHO', 'PERDIDO'] },
          ...repFilter,
          ...foraDaTriagem,
        },
        orderBy: { etapaDesde: 'asc' },
        take: 3,
        select: {
          id: true,
          nome: true,
          etapaDesde: true,
          funilEtapa: { select: { nome: true } },
          etapa: true,
        },
      }),
      this.prisma.fluxo.groupBy({
        by: ['status'],
        where: { empresaId, status: { not: 'ARQUIVADO' } },
        _count: { _all: true },
      }),
      this.prisma.fluxoExecucao.groupBy({
        by: ['status'],
        where: { empresaId, criadoEm: { gte: new Date(agora.getTime() - DIA_MS) } },
        _count: { _all: true },
      }),
      // Execuções com FALHA (últimos 7d) — vão pra triagem com o erro e o link.
      ehGestao
        ? this.prisma.fluxoExecucao.findMany({
            where: {
              empresaId,
              status: 'FALHOU',
              criadoEm: { gte: new Date(agora.getTime() - 7 * DIA_MS) },
            },
            orderBy: { criadoEm: 'desc' },
            take: 30,
            select: {
              id: true,
              fluxoId: true,
              erroMsg: true,
              terminouEm: true,
              criadoEm: true,
              fluxo: { select: { nome: true } },
            },
          })
        : Promise.resolve([]),
      // Agenda é PESSOAL: tarefas de HOJE do usuário logado.
      this.prisma.agendaItem.count({
        where: {
          empresaId,
          usuarioId: user.id,
          data: { gte: inicioDoDia(agora), lt: new Date(inicioDoDia(agora).getTime() + DIA_MS) },
        },
      }),
      // Prontidão: SLA modelado mas SEM ação configurada (acaoSlaExpirado null).
      this.prisma.funilEtapa.count({
        where: {
          funil: { empresaId },
          OR: [{ slaDias: { not: null } }, { slaHoras: { not: null } }],
          // Campo Json nullable: AnyNull cobre tanto NULL do banco quanto JSON null.
          acaoSlaExpirado: { equals: Prisma.AnyNull },
        },
      }),
      this.prisma.funil.findMany({
        where: { empresaId, ativo: true },
        select: { id: true, nome: true, _count: { select: { leads: true } } },
      }),
      this.prisma.evolutionInstancia.count({ where: { empresaId } }),
      // M6 — sala de controle: todos os fluxos não-arquivados.
      ehGestao
        ? this.prisma.fluxo.findMany({
            where: { empresaId, status: { not: 'ARQUIVADO' } },
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true, status: true, triggerTipo: true, triggerConfig: true },
          })
        : Promise.resolve([]),
      // Execuções POR DIA por fluxo (7d) — alimenta o sparkline do M6. Agregado
      // no banco (date_trunc), nunca no cliente.
      ehGestao
        ? this.prisma.$queryRaw<
            Array<{ fluxoId: string; dia: Date; ok: bigint; erro: bigint; total: bigint }>
          >`
            SELECT "fluxoId",
                   date_trunc('day', "criadoEm") AS dia,
                   COUNT(*) FILTER (WHERE "status" = 'CONCLUIDO') AS ok,
                   COUNT(*) FILTER (WHERE "status" = 'FALHOU') AS erro,
                   COUNT(*) AS total
            FROM "FluxoExecucao"
            WHERE "empresaId" = ${empresaId}
              AND "criadoEm" >= ${new Date(agora.getTime() - 7 * DIA_MS)}
            GROUP BY 1, 2
          `
        : Promise.resolve([]),
    ]);

    // ── M3 Agenda de hoje — "o que EU faço" + "o que a MÁQUINA faz" ───────
    // Uma lista SÓ, ordenada por hora: ver o robô agendado ao lado dos próprios
    // compromissos é o que dá sensação de controle (regra do card: não separar).
    const fimDoDia = new Date(inicioDoDia(agora).getTime() + DIA_MS);
    const agendaEventos = await this.prisma.agendaItem.findMany({
      where: { empresaId, usuarioId: user.id, data: { gte: inicioDoDia(agora), lt: fimDoDia } },
      orderBy: { data: 'asc' },
      take: 12,
      select: { id: true, titulo: true, data: true, tipo: true },
    });
    const agendaHoje: Array<{
      hora: string;
      titulo: string;
      tipo: 'compromisso' | 'robo';
      detalhe: string | null;
      link: string;
    }> = agendaEventos.map((a) => ({
      hora: a.data.toISOString(),
      titulo: a.titulo,
      tipo: 'compromisso' as const,
      detalhe: a.tipo,
      link: '/agenda',
    }));
    if (ehGestao) {
      // Disparos do ROBÔ hoje: fluxos ATIVOS com CRON_AGENDADO cuja próxima
      // execução ainda cai hoje.
      for (const f of fluxosLista) {
        if (f.status !== 'ATIVO' || f.triggerTipo !== 'CRON_AGENDADO') continue;
        const cfg = (f.triggerConfig ?? {}) as {
          expressoes?: string[];
          expressao?: string;
          timezone?: string;
        };
        const exprs = cfg.expressoes?.length
          ? cfg.expressoes
          : cfg.expressao
            ? [cfg.expressao]
            : [];
        try {
          const prox = proximaExecucaoCrons(exprs, cfg.timezone ?? TZ_PADRAO, agora);
          if (prox && prox.getTime() < fimDoDia.getTime()) {
            agendaHoje.push({
              hora: prox.toISOString(),
              titulo: f.nome,
              tipo: 'robo',
              detalhe: 'disparo automático',
              link: `/fluxos/${f.id}`,
            });
          }
        } catch {
          // expressão inválida não derruba a agenda
        }
      }
    }
    agendaHoje.sort((a, b) => a.hora.localeCompare(b.hora));

    // ── Quadros (Diretor atrasados + 📥 Nutrir) — só gestão ────────────────
    let cardsAtrasados: Array<{
      id: string;
      titulo: string;
      dataEntrega: Date | null;
      boardId: string;
    }> = [];
    let nutrirPendentes = 0;
    let nutrirBoardId: string | null = null;
    // ── M4 Mensagens internas — feed dos comentários dos quadros ─────────
    let mensagens: Array<{
      id: string;
      autorNome: string;
      cardId: string;
      cardTitulo: string;
      boardId: string;
      texto: string;
      criadoEm: string;
      mencionaMim: boolean;
    }> = [];
    if (ehGestao) {
      const boards = await this.prisma.kanbanBoard.findMany({
        where: { empresaId },
        select: { id: true, nome: true },
      });
      const boardDiretor = boards.find((b) => b.nome.toLowerCase().includes('diretor'));
      const boardNutrir = boards.find((b) => b.nome.toLowerCase().includes('nutrir'));
      nutrirBoardId = boardNutrir?.id ?? null;

      // Feed de mensagens: últimos comentários de QUALQUER quadro da empresa,
      // com autor + card + quadro. "Menção" = heurística barata (cita meu nome).
      const nomeLower = (user.nome ?? '').trim().toLowerCase();
      const comentarios = await this.prisma.kanbanComentario.findMany({
        where: { card: { lista: { board: { empresaId } } } },
        orderBy: { criadoEm: 'desc' },
        take: 12,
        select: {
          id: true,
          texto: true,
          criadoEm: true,
          autor: { select: { nome: true } },
          card: { select: { id: true, titulo: true, lista: { select: { boardId: true } } } },
        },
      });
      mensagens = comentarios.map((c) => ({
        id: c.id,
        autorNome: c.autor.nome,
        cardId: c.card.id,
        cardTitulo: c.card.titulo,
        boardId: c.card.lista.boardId,
        texto: c.texto.slice(0, 240),
        criadoEm: c.criadoEm.toISOString(),
        mencionaMim: nomeLower.length > 2 && c.texto.toLowerCase().includes(nomeLower),
      }));

      const [atrasados, nutrirCount] = await Promise.all([
        boardDiretor
          ? this.prisma.kanbanCard.findMany({
              where: {
                lista: { boardId: boardDiretor.id, arquivada: false },
                concluido: false,
                dataEntrega: { lt: agora },
              },
              orderBy: { dataEntrega: 'asc' },
              take: 5,
              select: {
                id: true,
                titulo: true,
                dataEntrega: true,
                lista: { select: { boardId: true } },
              },
            })
          : Promise.resolve([]),
        boardNutrir
          ? this.prisma.kanbanCard.count({
              where: {
                concluido: false,
                lista: {
                  boardId: boardNutrir.id,
                  arquivada: false,
                  nome: { contains: 'processar', mode: 'insensitive' },
                },
              },
            })
          : Promise.resolve(0),
      ]);
      cardsAtrasados = atrasados.map((c) => ({
        id: c.id,
        titulo: c.titulo,
        dataEntrega: c.dataEntrega,
        boardId: c.lista.boardId,
      }));
      nutrirPendentes = nutrirCount;
    }

    // ── Pulso (M1) ────────────────────────────────────────────────────────
    const contagem = (arr: Array<{ status: string; _count: { _all: number } }>, s: string) =>
      arr.find((x) => x.status === s)?._count._all ?? 0;
    const fluxosAtivos = contagem(fluxosPorStatus, 'ATIVO');
    const fluxosTotal = fluxosPorStatus.reduce((s, x) => s + x._count._all, 0);

    const pulso = {
      leadsNovos7d,
      leadsSlaEstourado: slaRows.length,
      fluxos: { ativos: fluxosAtivos, total: fluxosTotal },
      execucoes24h: { ok: contagem(exec24h, 'CONCLUIDO'), erro: contagem(exec24h, 'FALHOU') },
      nutrirPendentes,
      tarefasHoje,
    };

    // ── Triagem (M2) — fila ÚNICA, ordenada por urgência ──────────────────
    const triagem: TriagemItem[] = [];
    for (const r of slaRows.slice(0, 5)) {
      const slaMs = (r.slaDias ?? 0) * DIA_MS + (r.slaHoras ?? 0) * 3_600_000;
      const estouradoDias = Math.floor((agora.getTime() - r.etapaDesde.getTime() - slaMs) / DIA_MS);
      triagem.push({
        tipo: 'sla',
        titulo: r.nome,
        motivo: `SLA de ${r.slaDias ? `${r.slaDias}d` : `${r.slaHoras}h`} estourado${estouradoDias > 0 ? ` há ${estouradoDias}d` : ''} em "${r.etapaNome}"`,
        desde: r.etapaDesde.toISOString(),
        link: '/leads',
        // Quanto mais estourado, mais urgente. Base 100 deixa SLA acima de "parado".
        urgencia: 100 + estouradoDias,
      });
    }
    for (const f of falhas7d.slice(0, 5)) {
      triagem.push({
        tipo: 'fluxo_falha',
        titulo: f.fluxo.nome,
        motivo: `Execução falhou: ${(f.erroMsg ?? 'erro desconhecido').slice(0, 120)}`,
        desde: (f.terminouEm ?? f.criadoEm).toISOString(),
        link: `/fluxos/${f.fluxoId}`,
        urgencia: 90,
      });
    }
    for (const c of cardsAtrasados) {
      const atrasoDias = c.dataEntrega
        ? Math.floor((agora.getTime() - c.dataEntrega.getTime()) / DIA_MS)
        : 0;
      triagem.push({
        tipo: 'card_atrasado',
        titulo: c.titulo,
        motivo: `Tarefa atrasada${atrasoDias > 0 ? ` há ${atrasoDias}d` : ''} no quadro do Diretor`,
        desde: c.dataEntrega?.toISOString() ?? null,
        link: `/kanban/${c.boardId}`,
        urgencia: 60 + atrasoDias,
      });
    }
    // Leads parados só entram se ainda não estão na fila via SLA (não duplicar a
    // mesma pessoa por dois motivos).
    const jaNaFila = new Set(slaRows.map((r) => r.id));
    for (const l of paradoRows) {
      if (jaNaFila.has(l.id)) continue;
      const dias = Math.floor((agora.getTime() - l.etapaDesde.getTime()) / DIA_MS);
      if (dias < 3) continue; // parado de verdade, não recém-chegado
      triagem.push({
        tipo: 'parado',
        titulo: l.nome,
        motivo: `Parado há ${dias}d em "${l.funilEtapa?.nome ?? l.etapa}"`,
        desde: l.etapaDesde.toISOString(),
        link: '/leads',
        urgencia: 40 + Math.min(dias, 30),
      });
    }
    if (nutrirPendentes > 0 && nutrirBoardId) {
      triagem.push({
        tipo: 'nutrir',
        titulo: `${nutrirPendentes} ite${nutrirPendentes === 1 ? 'm' : 'ns'} no 📥 Nutrir`,
        motivo: 'Informação crua aguardando processamento (/nutrir-quadros)',
        desde: null,
        link: `/kanban/${nutrirBoardId}`,
        urgencia: 30,
      });
    }
    triagem.sort((a, b) => b.urgencia - a.urgencia);

    // ── Prontidão — o que falta pra ligar a máquina ───────────────────────
    const funisSemLead = funisComContagem.filter((f) => f._count.leads === 0);
    const prontidao = {
      // Sem automação rodando = a máquina está desligada → o dashboard mostra o
      // caminho em vez de gráfico zerado.
      ativo: fluxosAtivos === 0,
      linhas: [
        {
          texto: `${fluxosAtivos}/${fluxosTotal} fluxos ativos (${contagem(fluxosPorStatus, 'RASCUNHO')} rascunho, ${contagem(fluxosPorStatus, 'PAUSADO')} pausados)`,
          proximoPasso: 'Revisar e ativar os fluxos prontos',
          link: '/fluxos',
        },
        ...(etapasSlaSemAcao > 0
          ? [
              {
                texto: `${etapasSlaSemAcao} etapa(s) com SLA cadastrado mas SEM ação configurada`,
                proximoPasso: 'Definir o que acontece quando o SLA estoura',
                link: '/funis',
              },
            ]
          : []),
        ...(funisSemLead.length > 0
          ? [
              {
                texto: `Funis sem nenhum lead: ${funisSemLead.map((f) => f.nome).join(' · ')}`,
                proximoPasso: 'Importar/capturar leads ou arquivar o funil',
                link: '/leads',
              },
            ]
          : []),
        ...(whatsappInstancias === 0
          ? [
              {
                texto: 'WhatsApp da empresa não conectado',
                proximoPasso: 'Conectar em Sistema → Integrações',
                link: '/integracoes',
              },
            ]
          : []),
        ...(nutrirPendentes > 0 && nutrirBoardId
          ? [
              {
                texto: `${nutrirPendentes} item(ns) crus no 📥 Nutrir`,
                proximoPasso: 'Rodar /nutrir-quadros pra distribuir',
                link: `/kanban/${nutrirBoardId}`,
              },
            ]
          : []),
      ],
    };

    // ── M6 — sala de controle dos fluxos ──────────────────────────────────
    // Monta série de 7 buckets diários (hoje-6 … hoje) por fluxo + totais.
    const diaKey = (d: Date) => {
      const x = inicioDoDia(d);
      return x.getTime();
    };
    const buckets: number[] = [];
    for (let i = 6; i >= 0; i--) buckets.push(diaKey(new Date(agora.getTime() - i * DIA_MS)));
    const execPorFluxo = new Map<
      string,
      { ok: number; erro: number; total: number; serie: number[] }
    >();
    for (const g of exec7dPorFluxo) {
      const atual = execPorFluxo.get(g.fluxoId) ?? {
        ok: 0,
        erro: 0,
        total: 0,
        serie: new Array<number>(buckets.length).fill(0),
      };
      const ok = Number(g.ok);
      const erro = Number(g.erro);
      const total = Number(g.total);
      atual.ok += ok;
      atual.erro += erro;
      atual.total += total;
      const idx = buckets.indexOf(diaKey(new Date(g.dia)));
      if (idx >= 0) atual.serie[idx] += total;
      execPorFluxo.set(g.fluxoId, atual);
    }
    const ultimoErroPorFluxo = new Map<string, string>();
    for (const f of falhas7d) {
      if (!ultimoErroPorFluxo.has(f.fluxoId)) {
        ultimoErroPorFluxo.set(f.fluxoId, (f.erroMsg ?? '').slice(0, 160));
      }
    }
    const fluxosSala = fluxosLista.map((f) => {
      const exec = execPorFluxo.get(f.id) ?? {
        ok: 0,
        erro: 0,
        total: 0,
        serie: new Array<number>(buckets.length).fill(0),
      };
      // Próximo disparo só faz sentido pra CRON_AGENDADO ativo — usa o mesmo
      // util do job (expressoes[] com fallback pra expressao legada).
      let proximoDisparo: string | null = null;
      if (f.status === 'ATIVO' && f.triggerTipo === 'CRON_AGENDADO') {
        const cfg = (f.triggerConfig ?? {}) as {
          expressoes?: string[];
          expressao?: string;
          timezone?: string;
        };
        const exprs = cfg.expressoes?.length
          ? cfg.expressoes
          : cfg.expressao
            ? [cfg.expressao]
            : [];
        try {
          proximoDisparo =
            proximaExecucaoCrons(exprs, cfg.timezone ?? TZ_PADRAO, agora)?.toISOString() ?? null;
        } catch {
          proximoDisparo = null;
        }
      }
      return {
        id: f.id,
        nome: f.nome,
        status: f.status,
        triggerTipo: f.triggerTipo,
        exec7d: exec,
        pctSucesso: exec.total > 0 ? Math.round((exec.ok / exec.total) * 100) : null,
        ultimoErro: ultimoErroPorFluxo.get(f.id) ?? null,
        proximoDisparo,
      };
    });

    return { pulso, triagem, prontidao, fluxosSala, agendaHoje, mensagens };
  }
}

/** Meia-noite LOCAL do servidor — suficiente pro corte "tarefas de hoje". */
function inicioDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
