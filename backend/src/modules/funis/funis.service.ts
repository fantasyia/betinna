import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import { type AtribuicaoResumo, resumoAtribuicao } from '@modules/leads/atribuicao.util';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  CreateFunilDto,
  CreateFunilEtapaDto,
  LeadsPorEtapaQueryDto,
  ReordenarEtapasDto,
  UpdateFunilDto,
  UpdateFunilEtapaDto,
} from './funis.dto';
import type {
  AtribuicaoPorCampanhaQueryDto,
  HistoricoEtapasQueryDto,
} from '@modules/leads/leads.dto';
import { PROBABILIDADE_POR_ETAPA } from '@modules/leads/leads.constants';

/** Lead resumido dentro de uma etapa (Demanda MCP `leads_por_etapa`). */
export interface LeadEtapaResumo {
  leadId: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  tags: string[];
  dataEntrada: string;
  representante: { id: string; nome: string } | null;
  /** Atribuição de marketing (null nos leads sem rastreio — antigos/orgânicos). */
  atribuicao: AtribuicaoResumo;
  valorFechado: number | null;
}

const funilInclude = {
  etapas: { orderBy: { ordem: 'asc' as const } },
  _count: { select: { leads: true } },
} satisfies Prisma.FunilInclude;

type FunilRaw = Prisma.FunilGetPayload<{ include: typeof funilInclude }>;

/** Fluxo que aponta pra uma etapa (via CRIAR_LEAD ou MOVER_LEAD_ETAPA). */
export interface FluxoQueAponta {
  id: string;
  nome: string;
  status: string;
  acaoTipo: string;
}

/** Etapa decorada com uso real — base pra não apagar/mexer em etapa em produção
 *  sem saber o impacto (card "MCP: escrita de FUNIL e ETAPA", item 7). */
export type EtapaComUso = FunilRaw['etapas'][number] & {
  leadsCount: number;
  fluxosQueApontam: FluxoQueAponta[];
};

export type FunilWithRel = Omit<FunilRaw, 'etapas'> & {
  etapas: EtapaComUso[];
  /** Alertas não-fatais da última operação (ex: rename que deixa condição frágil). */
  avisos?: string[];
};

@Injectable()
export class FunisService {
  private readonly logger = new Logger(FunisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
  ) {}

  /**
   * Leads dentro de UMA etapa de um funil, paginado. Ordena por `etapaDesde` asc
   * (mais parados primeiro — útil pra "quem está travado há X dias"). READ-only,
   * respeita tenant + carteira (RepScope). Base do MCP `leads_por_etapa`.
   */
  async leadsPorEtapa(
    user: AuthenticatedUser,
    funilId: string,
    etapaId: string,
    q: LeadsPorEtapaQueryDto,
  ): Promise<Paginated<LeadEtapaResumo>> {
    const empresaId = this.requireEmpresa(user);
    const etapa = await this.prisma.funilEtapa.findFirst({
      where: { id: etapaId, funilId, funil: { empresaId } },
      select: { id: true },
    });
    if (!etapa) throw new NotFoundException('Etapa', etapaId);

    const scope = await this.repScope.getRepIds(user);
    const where: Prisma.LeadWhereInput = {
      empresaId,
      funilId,
      funilEtapaId: etapaId,
      ...(scope !== null ? { representanteId: { in: scope.length ? scope : ['__none__'] } } : {}),
    };
    const [total, leads] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy: { etapaDesde: 'asc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: {
          id: true,
          nome: true,
          contatoNome: true,
          contatoEmail: true,
          contatoTelefone: true,
          etapaDesde: true,
          representante: { select: { id: true, nome: true } },
          tags: { select: { tag: { select: { nome: true } } } },
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
          origemCadastro: true,
          formularioOrigem: true,
          valorFechado: true,
          variaveis: true,
        },
      }),
    ]);
    const data: LeadEtapaResumo[] = leads.map((l) => ({
      leadId: l.id,
      nome: l.contatoNome || l.nome,
      email: l.contatoEmail,
      telefone: l.contatoTelefone,
      tags: l.tags.map((t) => t.tag.nome),
      dataEntrada: l.etapaDesde.toISOString(),
      representante: l.representante,
      atribuicao: resumoAtribuicao(l),
      // ResponseInterceptor converte Decimal→number nas respostas; aqui pra manter o tipo.
      valorFechado: l.valorFechado === null ? null : Number(l.valorFechado),
    }));
    return buildPaginated(data, total, q.page, q.limit);
  }

  /**
   * Histórico de transição de etapas (MCP `etapa_historico`). READ-only. Filtra
   * por funil/lead/período; escopo tenant + carteira (RepScope via relação Lead).
   * Resolve nomes de etapa (funilEtapa), do lead e de quem moveu. Ordem: trajetória
   * cronológica (asc) quando é 1 lead; feed recente (desc) quando é varredura.
   */
  async historicoEtapas(
    user: AuthenticatedUser,
    q: HistoricoEtapasQueryDto,
  ): Promise<
    Paginated<{
      leadId: string;
      leadNome: string;
      funilId: string | null;
      etapaOrigem: { id: string; nome: string } | null;
      etapaDestino: { id: string; nome: string } | null;
      quem: { id: string; nome: string } | null;
      origemMudanca: string;
      ocorridoEm: string;
    }>
  > {
    const empresaId = this.requireEmpresa(user);
    const scope = await this.repScope.getRepIds(user);
    const where: Prisma.LeadEtapaHistoricoWhereInput = {
      empresaId,
      ...(q.funilId ? { funilId: q.funilId } : {}),
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.de || q.ate
        ? {
            ocorridoEm: {
              ...(q.de ? { gte: new Date(q.de) } : {}),
              ...(q.ate ? { lte: new Date(q.ate) } : {}),
            },
          }
        : {}),
      // Carteira: só transições de leads que o usuário ENXERGA (via relação).
      ...(scope !== null
        ? { lead: { representanteId: { in: scope.length ? scope : ['__none__'] } } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.leadEtapaHistorico.count({ where }),
      this.prisma.leadEtapaHistorico.findMany({
        where,
        orderBy: { ocorridoEm: q.leadId ? 'asc' : 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: {
          leadId: true,
          funilId: true,
          etapaOrigem: true,
          etapaDestino: true,
          quem: true,
          origemMudanca: true,
          ocorridoEm: true,
          lead: { select: { nome: true, contatoNome: true } },
        },
      }),
    ]);

    // Resolve nomes de etapa (funilEtapa) e de quem moveu, em lote.
    const etapaIds = [
      ...new Set(
        rows.flatMap((r) => [r.etapaOrigem, r.etapaDestino]).filter((x): x is string => !!x),
      ),
    ];
    const userIds = [...new Set(rows.map((r) => r.quem).filter((x): x is string => !!x))];
    const [etapas, usuarios] = await Promise.all([
      etapaIds.length
        ? this.prisma.funilEtapa.findMany({
            where: { id: { in: etapaIds }, funil: { empresaId } },
            select: { id: true, nome: true },
          })
        : [],
      userIds.length
        ? this.prisma.usuario.findMany({
            where: { id: { in: userIds } },
            select: { id: true, nome: true },
          })
        : [],
    ]);
    const nomeEtapa = new Map(etapas.map((e) => [e.id, e.nome]));
    const nomeUser = new Map(usuarios.map((u) => [u.id, u.nome]));
    // Etapa que não é funilEtapa (enum legado / criação) → usa o valor cru como nome.
    const resolverEtapa = (id: string | null) =>
      id ? { id, nome: nomeEtapa.get(id) ?? id } : null;

    const data = rows.map((r) => ({
      leadId: r.leadId,
      leadNome: r.lead?.contatoNome || r.lead?.nome || r.leadId,
      funilId: r.funilId,
      etapaOrigem: resolverEtapa(r.etapaOrigem),
      etapaDestino: resolverEtapa(r.etapaDestino),
      quem: r.quem ? { id: r.quem, nome: nomeUser.get(r.quem) ?? r.quem } : null,
      origemMudanca: r.origemMudanca,
      ocorridoEm: r.ocorridoEm.toISOString(),
    }));
    return buildPaginated(data, total, q.page, q.limit);
  }

  /**
   * Atribuição por campanha (MCP `atribuicao_por_campanha`). READ-only, multi-tenant
   * (empresaId — usa o índice (empresaId, utmCampaign)) + carteira. utmCampaign
   * AUSENTE → leads SEM atribuição (vazamento de rastreio). Filtra por origem/
   * source/medium e período (criadoEm). Responde "essa campanha vale a pena?".
   */
  async atribuicaoPorCampanha(user: AuthenticatedUser, q: AtribuicaoPorCampanhaQueryDto) {
    const empresaId = this.requireEmpresa(user);
    const scope = await this.repScope.getRepIds(user);
    const de = q.dataInicio ? new Date(q.dataInicio) : undefined;
    const ate = q.dataFim ? new Date(q.dataFim) : undefined;

    const where: Prisma.LeadWhereInput = {
      empresaId,
      // utmCampaign ausente = "sem atribuição" (IS NULL); presente = igualdade.
      utmCampaign: q.utmCampaign ?? null,
      ...(q.origemCadastro ? { origemCadastro: q.origemCadastro } : {}),
      ...(q.utmSource ? { utmSource: q.utmSource } : {}),
      ...(q.utmMedium ? { utmMedium: q.utmMedium } : {}),
      ...(de || ate
        ? { criadoEm: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } }
        : {}),
      ...(scope !== null ? { representanteId: { in: scope.length ? scope : ['__none__'] } } : {}),
    };

    // Funis de TRIAGEM da empresa — precisam ser conhecidos ANTES das contagens
    // porque separam "descartado na triagem" de "perdido de verdade" (ver abaixo).
    const triagemIds = (
      await this.prisma.funil.findMany({
        where: { empresaId, triagem: true },
        select: { id: true },
      })
    ).map((f) => f.id);

    // ⚠️ Perda COMERCIAL vs DESCARTE de triagem. Os dois viram `etapa: 'PERDIDO'`
    // no enum legado (uma etapa custom tipo PERDIDO mapeia pro mesmo enum), então
    // contar só pelo enum misturaria "o cliente disse não" com "era spam". São
    // coisas diferentes: perdido é sinal sobre a OFERTA, descartado é sinal sobre
    // a QUALIDADE DO TRÁFEGO da campanha. Separamos pelo funil.
    const wherePerdaComercial: Prisma.LeadWhereInput = {
      ...where,
      etapa: 'PERDIDO',
      // `notIn` descarta NULL no Postgres — lead sem funil é perda comercial.
      ...(triagemIds.length ? { OR: [{ funilId: null }, { funilId: { notIn: triagemIds } }] } : {}),
    };

    const [totalLeads, ganhos, perdidos, porEtapa, porOrigem, fechado, ganhosLeads] =
      await Promise.all([
        this.prisma.lead.count({ where }),
        this.prisma.lead.count({ where: { ...where, etapa: 'GANHO' } }),
        this.prisma.lead.count({ where: wherePerdaComercial }),
        // Distribuição por etapa (funilEtapaId; null = sem funil/etapa custom).
        this.prisma.lead.groupBy({
          by: ['funilEtapaId', 'etapa'],
          where,
          _count: { _all: true },
          _sum: { valorEstimado: true },
        }),
        // Breakdown por origemCadastro (o card pede filtrar/agrupar por origem).
        this.prisma.lead.groupBy({
          by: ['origemCadastro'],
          where,
          _count: { _all: true },
        }),
        // valorFechado real dos GANHOS (nulls ignorados no _sum).
        this.prisma.lead.aggregate({ where, _sum: { valorFechado: true } }),
        // Ciclo médio: da captura (criadoEm) ao fechamento (fechadoEm) dos GANHOS.
        this.prisma.lead.findMany({
          where: { ...where, etapa: 'GANHO', fechadoEm: { not: null } },
          select: { criadoEm: true, fechadoEm: true },
        }),
      ]);

    // Nomes + probabilidade das etapas custom presentes.
    const etapaIds = [
      ...new Set(porEtapa.map((g) => g.funilEtapaId).filter((x): x is string => !!x)),
    ];
    const etapas = etapaIds.length
      ? await this.prisma.funilEtapa.findMany({
          where: { id: { in: etapaIds }, funil: { empresaId } },
          select: { id: true, nome: true, probabilidade: true },
        })
      : [];
    const etapaInfo = new Map(etapas.map((e) => [e.id, e]));

    // valorPonderado = Σ(valorEstimado × probabilidade/100). Etapa custom usa a
    // probabilidade dela; lead sem funil (funilEtapaId null) usa o enum legado.
    let valorPonderado = 0;
    const leadsPorEtapa = porEtapa.map((g) => {
      const info = g.funilEtapaId ? etapaInfo.get(g.funilEtapaId) : null;
      const prob = info ? info.probabilidade : PROBABILIDADE_POR_ETAPA[g.etapa];
      const soma = g._sum.valorEstimado ? Number(g._sum.valorEstimado) : 0;
      valorPonderado += (soma * prob) / 100;
      return {
        etapaId: g.funilEtapaId,
        nome: info?.nome ?? g.etapa, // custom → nome; sem funil → enum legado
        quantidade: g._count._all,
        valorEstimado: soma,
      };
    });

    // Descartados na triagem (só existe se a empresa tiver funil de triagem).
    const descartadosTriagem = triagemIds.length
      ? await this.prisma.lead.count({
          where: { ...where, etapa: 'PERDIDO', funilId: { in: triagemIds } },
        })
      : 0;

    // ── CAMADA DE CONVERSA ────────────────────────────────────────────────
    // O lead de Click-to-WhatsApp nasce de uma CONVERSA, e nem toda conversa vira
    // lead (a triagem existe justamente pra isso). Medir só lead esconderia metade
    // da campanha: 300 conversas que geraram 12 leads e 300 que geraram 120 têm o
    // mesmo `totalLeads` por real gasto só se você olhar o topo do funil.
    // Usa a COLUNA indexada Conversation.utmCampaign (por isso ela não é só JSON).
    const whereConversa: Prisma.ConversationWhereInput = {
      empresaId,
      utmCampaign: q.utmCampaign ?? null,
      ...(de || ate
        ? { criadoEm: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } }
        : {}),
      // Carteira: conversa de WhatsApp PESSOAL tem dono (proprietarioId); a do
      // número da empresa é null e fica com a gestão. Mesmo recorte do Inbox.
      ...(scope !== null ? { proprietarioId: { in: scope.length ? scope : ['__none__'] } } : {}),
    };
    const [totalConversas, conversasQueViraramLead] = await Promise.all([
      this.prisma.conversation.count({ where: whereConversa }),
      this.prisma.conversation.count({ where: { ...whereConversa, leadId: { not: null } } }),
    ]);
    const taxaConversaParaLead =
      totalConversas > 0 ? Math.round((conversasQueViraramLead / totalConversas) * 1000) / 10 : 0;

    const dias = ganhosLeads
      .map((l) => (l.fechadoEm!.getTime() - l.criadoEm.getTime()) / (1000 * 60 * 60 * 24))
      .filter((d) => d >= 0);
    const cicloMedioDias = dias.length
      ? Math.round(dias.reduce((s, d) => s + d, 0) / dias.length)
      : 0;

    return {
      utmCampaign: q.utmCampaign ?? null,
      periodo: { de: de?.toISOString() ?? null, ate: ate?.toISOString() ?? null },
      totalLeads,
      leadsPorEtapa,
      porOrigemCadastro: porOrigem.map((o) => ({
        origemCadastro: o.origemCadastro,
        quantidade: o._count._all,
      })),
      valorPonderado: Math.round(valorPonderado * 100) / 100,
      valorFechado: fechado._sum.valorFechado ? Number(fechado._sum.valorFechado) : 0,
      ganhos,
      /** Perda COMERCIAL (a oferta não convenceu) — NÃO inclui descarte de triagem. */
      perdidos,
      /** Descartado na TRIAGEM (não era oportunidade) — sinal sobre a QUALIDADE do tráfego. */
      descartadosTriagem,
      /** Conversas de WhatsApp atribuídas a esta campanha (topo do funil do CTWA). */
      totalConversas,
      conversasQueViraramLead,
      /** % das conversas da campanha que viraram lead (1 casa decimal). */
      taxaConversaParaLead,
      cicloMedioDias,
    };
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }

  /** ADMIN/DIRETOR podem tudo; os demais (REP etc.) não mexem em funil protegido. */
  private ehAdminOuDiretor(user: AuthenticatedUser): boolean {
    return user.role === 'ADMIN' || user.role === 'DIRECTOR';
  }

  /**
   * Bloqueia editar/excluir um funil PROTEGIDO (obrigatório) por quem não é
   * ADMIN/DIRETOR. Rep não exclui nem edita os funis padrão da empresa.
   */
  private assertPodeEditar(user: AuthenticatedUser, funil: { protegido: boolean }): void {
    if (funil.protegido && !this.ehAdminOuDiretor(user)) {
      throw new ForbiddenException(
        'Este funil é obrigatório/protegido — só ADMIN ou Diretor pode editá-lo ou excluí-lo.',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
  }

  async list(user: AuthenticatedUser): Promise<FunilWithRel[]> {
    const empresaId = this.requireEmpresa(user);
    const funis = await this.prisma.funil.findMany({
      // REP vê SÓ funil marcado como visível pra ele. Antes vinham todos: a
      // triagem bruta do SAC, a nutrição de e-mail e o funil de RECRUTAMENTO DE
      // REPS — a esteira em que ele mesmo foi captado, com os concorrentes dele
      // dentro. Gestão (ADMIN/DIRECTOR/GERENTE/SAC) continua vendo tudo.
      where: { empresaId, ...(user.role === 'REP' ? { visivelParaRep: true } : {}) },
      orderBy: [{ isPadrao: 'desc' }, { ordem: 'asc' }, { nome: 'asc' }],
      include: funilInclude,
    });
    return this.comUso(funis, user);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<FunilWithRel> {
    const empresaId = this.requireEmpresa(user);
    const funil = await this.prisma.funil.findFirst({
      // MESMO filtro da lista. Sem ele, esconder na listagem seria decoração:
      // bastava o rep abrir a URL do funil direto pra ver o que não é dele.
      where: { id, empresaId, ...(user.role === 'REP' ? { visivelParaRep: true } : {}) },
      include: funilInclude,
    });
    if (!funil) throw new NotFoundException('Funil', id);
    return (await this.comUso([funil], user))[0];
  }

  /**
   * Fluxos ativos/os que apontam pra estas etapas (via config JSON dos nós
   * CRIAR_LEAD/MOVER_LEAD_ETAPA — sem FK, então é busca por texto no JSON).
   * Base pra não apagar/renomear etapa sem saber o impacto real (card "MCP:
   * escrita de FUNIL e ETAPA", item 7 — evita quebrar fluxo silenciosamente).
   */
  private async fluxosPorEtapaIds(etapaIds: string[]): Promise<Map<string, FluxoQueAponta[]>> {
    const mapa = new Map<string, FluxoQueAponta[]>();
    if (etapaIds.length === 0) return mapa;
    // TODAS as formas de um nó apontar pra uma etapa — cada tipo guarda numa
    // chave diferente. Só a 1ª era coberta: apagar uma etapa vazia que era
    // `paraEtapa` de um gatilho, ou origem/destino de um LIBERAR_LOTE, passava
    // sem aviso e o fluxo parava de disparar em silêncio.
    const rows = await this.prisma.$queryRaw<
      Array<{ etapaId: string; id: string; nome: string; status: string; acaoTipo: string }>
    >(Prisma.sql`
      SELECT "etapaId", id, nome, status, "acaoTipo" FROM (
        SELECT fn."config" ->> 'funilEtapaId' AS "etapaId", f.id, f.nome, f.status,
               COALESCE(fn."acaoTipo"::text, fn.tipo::text) AS "acaoTipo"
          FROM "FluxoNo" fn JOIN "Fluxo" f ON f.id = fn."fluxoId"
         WHERE fn."config" ->> 'funilEtapaId' IS NOT NULL
        UNION ALL
        SELECT fn."config" ->> 'paraEtapa', f.id, f.nome, f.status, 'TRIGGER'
          FROM "FluxoNo" fn JOIN "Fluxo" f ON f.id = fn."fluxoId"
         WHERE fn."config" ->> 'paraEtapa' IS NOT NULL
        UNION ALL
        SELECT fn."config" ->> 'deEtapa', f.id, f.nome, f.status, 'TRIGGER'
          FROM "FluxoNo" fn JOIN "Fluxo" f ON f.id = fn."fluxoId"
         WHERE fn."config" ->> 'deEtapa' IS NOT NULL
        UNION ALL
        SELECT fn."config" ->> 'etapaOrigemId', f.id, f.nome, f.status, 'LIBERAR_LOTE'
          FROM "FluxoNo" fn JOIN "Fluxo" f ON f.id = fn."fluxoId"
         WHERE fn."config" ->> 'etapaOrigemId' IS NOT NULL
        UNION ALL
        SELECT fn."config" ->> 'etapaDestinoId', f.id, f.nome, f.status, 'LIBERAR_LOTE'
          FROM "FluxoNo" fn JOIN "Fluxo" f ON f.id = fn."fluxoId"
         WHERE fn."config" ->> 'etapaDestinoId' IS NOT NULL
        UNION ALL
        -- CONDICAO comparando lead.etapa_id (valor = id da etapa).
        SELECT fn."config" ->> 'valor', f.id, f.nome, f.status, 'CONDICAO'
          FROM "FluxoNo" fn JOIN "Fluxo" f ON f.id = fn."fluxoId"
         WHERE fn.tipo = 'CONDICAO' AND fn."config" ->> 'campo' = 'lead.etapa_id'
      ) refs
      WHERE "etapaId" IN (${Prisma.join(etapaIds)})
    `);
    for (const r of rows) {
      const lista = mapa.get(r.etapaId) ?? [];
      lista.push({ id: r.id, nome: r.nome, status: r.status, acaoTipo: r.acaoTipo });
      mapa.set(r.etapaId, lista);
    }
    return mapa;
  }

  /** Decora etapas com leadsCount + fluxosQueApontam (1 query de cada pro lote inteiro). */
  /**
   * Enriquece com contagem de leads por etapa e fluxos que apontam pra ela.
   *
   * A contagem respeita a CARTEIRA quando `user` é passado. Sem isso o rep via
   * o número de leads da EMPRESA INTEIRA em cada etapa — vazamento pior que ver
   * o nome do funil, porque entrega o tamanho do pipeline de todo mundo.
   */
  private async comUso(funis: FunilRaw[], user?: AuthenticatedUser): Promise<FunilWithRel[]> {
    const etapaIds = funis.flatMap((f) => f.etapas.map((e) => e.id));
    const escopo = user ? await this.repScope.getRepIds(user) : null;
    const filtroCarteira =
      escopo !== null ? { representanteId: { in: escopo.length ? escopo : ['__none__'] } } : {};
    const [porFluxo, porLead] = await Promise.all([
      this.fluxosPorEtapaIds(etapaIds),
      etapaIds.length
        ? this.prisma.lead.groupBy({
            by: ['funilEtapaId'],
            where: { funilEtapaId: { in: etapaIds }, ...filtroCarteira },
            _count: true,
          })
        : Promise.resolve([]),
    ]);
    const leadsPorEtapa = new Map(porLead.map((r) => [r.funilEtapaId, r._count]));
    return funis.map((f) => ({
      ...f,
      etapas: f.etapas.map((e) => ({
        ...e,
        leadsCount: leadsPorEtapa.get(e.id) ?? 0,
        fluxosQueApontam: porFluxo.get(e.id) ?? [],
      })),
    }));
  }

  async create(user: AuthenticatedUser, dto: CreateFunilDto): Promise<FunilWithRel> {
    const empresaId = this.requireEmpresa(user);

    const created = await this.prisma.$transaction(async (tx) => {
      // AUDITORIA (média): o desmarque dos outros `isPadrao` rodava FORA da
      // transação, antes do create. Se o create falhasse, a empresa ficava SEM
      // funil padrão nenhum — e dois creates concorrentes podiam terminar com
      // dois padrões (cada um desmarcou antes de o outro inserir). Dentro da tx,
      // ou tudo acontece ou nada.
      if (dto.isPadrao) {
        // Mesmo lock do update() (auditoria 20/08): dois CREATEs concorrentes
        // com isPadrao desmarcavam um ao outro antes de inserir → dois padrões.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${empresaId}))`;
        await tx.funil.updateMany({
          where: { empresaId, isPadrao: true },
          data: { isPadrao: false },
        });
      }
      const funil = await tx.funil.create({
        data: {
          empresaId,
          nome: dto.nome,
          descricao: dto.descricao,
          cor: dto.cor,
          ordem: dto.ordem,
          ativo: dto.ativo,
          isPadrao: dto.isPadrao,
          // Só ADMIN/DIRETOR pode marcar um funil como protegido/obrigatório.
          protegido: this.ehAdminOuDiretor(user) ? (dto.protegido ?? false) : false,
          // Idem pra triagem: tira o funil dos KPIs globais, é decisão de gestão.
          triagem: this.ehAdminOuDiretor(user) ? (dto.triagem ?? false) : false,
          tagsPermitidas: dto.tagsPermitidas
            ? (dto.tagsPermitidas as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
      if (dto.etapas && dto.etapas.length > 0) {
        await tx.funilEtapa.createMany({
          data: dto.etapas.map((e, idx) => ({
            funilId: funil.id,
            nome: e.nome,
            cor: e.cor,
            ordem: e.ordem || idx,
            tipo: e.tipo,
            probabilidade: e.probabilidade,
            slaDias: e.slaDias ?? null,
            slaHoras: e.slaHoras ?? null,
            capacidadeMaxima: e.capacidadeMaxima ?? null,
          })),
        });
      }
      return funil;
    });

    this.logger.log(`Funil ${created.nome} criado (empresa ${empresaId})`);
    return this.findById(user, created.id);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateFunilDto): Promise<FunilWithRel> {
    const existing = await this.findById(user, id);
    // Funil protegido: só ADMIN/DIRETOR edita.
    this.assertPodeEditar(user, existing);
    // A flag `protegido` só muda por ADMIN/DIRETOR — REP nem consegue chegar aqui
    // num protegido, mas garante que não ligue/desligue num não-protegido.
    if (dto.protegido !== undefined && !this.ehAdminOuDiretor(user)) {
      delete dto.protegido;
    }
    // Mesma regra pra `triagem` — tirar um funil dos KPIs globais é decisão de gestão.
    if (dto.triagem !== undefined && !this.ehAdminOuDiretor(user)) {
      delete dto.triagem;
    }

    // tagsPermitidas é Json nullable — null explícito precisa de Prisma.JsonNull.
    const { tagsPermitidas, ...rest } = dto;

    // AUDITORIA (#29): "desmarcar os outros padrão" e "marcar este" eram dois
    // comandos soltos. Duas pessoas promovendo funis diferentes a padrão ao
    // mesmo tempo (ou o mesmo usuário com clique duplo) terminavam com DOIS
    // funis `isPadrao: true` — e aí o lead sem funil explícito caía num ou noutro
    // dependendo da ordem do banco. Uma transação só, serializada por empresa.
    await this.prisma.$transaction(async (tx) => {
      if (dto.isPadrao) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.empresaId}))`;
        await tx.funil.updateMany({
          where: { empresaId: existing.empresaId, isPadrao: true, id: { not: id } },
          data: { isPadrao: false },
        });
      }
      await tx.funil.update({
        where: { id },
        data: {
          ...rest,
          ...(tagsPermitidas !== undefined
            ? {
                tagsPermitidas:
                  tagsPermitidas === null
                    ? Prisma.JsonNull
                    : (tagsPermitidas as Prisma.InputJsonValue),
              }
            : {}),
        },
      });
    });
    return this.findById(user, id);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    // Funil protegido/obrigatório: rep não exclui.
    this.assertPodeEditar(user, existing);

    // Fluxo apontando pra QUALQUER etapa bloqueia (auditoria 20/08): o guard
    // existia no removerEtapa, mas excluir o FUNIL inteiro pulava por cima —
    // o cascade apagava as etapas e todo MOVER_LEAD_ETAPA/CRIAR_LEAD que
    // guardava o id quebrava em silêncio na próxima execução. Mesmo molde do
    // guard de etapa.
    const fluxosApontando = new Map<string, string>();
    for (const e of existing.etapas) {
      for (const f of e.fluxosQueApontam) fluxosApontando.set(f.id, f.nome);
    }
    if (fluxosApontando.size > 0) {
      const nomes = [...fluxosApontando.values()].join(', ');
      throw new BusinessRuleException(
        `Funil usado por ${fluxosApontando.size} fluxo(s) (${nomes}) — ` +
          'ajuste os nós que apontam pras etapas dele antes de excluir.',
      );
    }

    // AUDITORIA (média): a contagem de leads e o delete eram operações separadas.
    // Um lead criado NA JANELA entre as duas (captura do site, importação,
    // triagem) era apagado junto — o `funilId` do lead tem onDelete: SetNull, o
    // lead virava órfão sem funil e sumia de todo kanban, sem erro. Re-contamos
    // DENTRO da transação, imediatamente antes de apagar.
    await this.prisma.$transaction(async (tx) => {
      const leads = await tx.lead.count({ where: { funilId: id } });
      if (leads > 0) {
        throw new BusinessRuleException(
          `Funil tem ${leads} lead(s) — mova-os pra outro funil antes de excluir.`,
        );
      }
      if (existing.isPadrao) {
        // Permite excluir o padrão mas avisa pra ter outro funil
        const outros = await tx.funil.count({
          where: { empresaId: existing.empresaId, id: { not: id } },
        });
        if (outros === 0) {
          throw new BusinessRuleException(
            'Não pode excluir o único funil. Crie outro funil antes.',
          );
        }
      }
      await tx.funil.delete({ where: { id } });
    });
  }

  // ─── Etapas ──────────────────────────────────────────────────────

  async adicionarEtapa(
    user: AuthenticatedUser,
    funilId: string,
    dto: CreateFunilEtapaDto,
  ): Promise<FunilWithRel> {
    this.assertPodeEditar(user, await this.findById(user, funilId)); // valida acesso + proteção
    // Auto-ordem: se ordem = 0 e já há etapas, coloca no final
    let ordemFinal = dto.ordem;
    if (ordemFinal === 0) {
      const max = await this.prisma.funilEtapa.findFirst({
        where: { funilId },
        orderBy: { ordem: 'desc' },
        select: { ordem: true },
      });
      ordemFinal = (max?.ordem ?? -1) + 1;
    }
    await this.prisma.funilEtapa.create({
      data: {
        funilId,
        nome: dto.nome,
        cor: dto.cor,
        ordem: ordemFinal,
        tipo: dto.tipo,
        probabilidade: dto.probabilidade,
        slaDias: dto.slaDias ?? null,
        slaHoras: dto.slaHoras ?? null,
        capacidadeMaxima: dto.capacidadeMaxima ?? null,
        acaoSlaExpirado: dto.acaoSlaExpirado
          ? (dto.acaoSlaExpirado as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
    return this.findById(user, funilId);
  }

  async atualizarEtapa(
    user: AuthenticatedUser,
    funilId: string,
    etapaId: string,
    dto: UpdateFunilEtapaDto,
  ): Promise<FunilWithRel> {
    const funilDaEtapa = await this.findById(user, funilId);
    this.assertPodeEditar(user, funilDaEtapa); // valida acesso + proteção
    const empresaId = funilDaEtapa.empresaId;
    const etapa = await this.prisma.funilEtapa.findFirst({
      where: { id: etapaId, funilId },
    });
    if (!etapa) throw new NotFoundException('Etapa', etapaId);

    // RENAME é seguro pros nós que guardam `funilEtapaId` (o id não muda), mas
    // NÃO pros CONDICAO que comparam a etapa por NOME (`lead.etapa_atual`).
    // Esses param de casar em silêncio: nenhum erro, o fluxo só desvia pro outro
    // ramo. Detecta e avisa — mesmo espírito do `fluxosQueApontam`.
    const renomeando = dto.nome !== undefined && dto.nome !== etapa.nome;
    const fragil = renomeando ? await this.condicoesQueComparamPorNome(empresaId, etapa.nome) : [];

    // acaoSlaExpirado é Json nullable — null explícito precisa de Prisma.JsonNull.
    const { acaoSlaExpirado, ...rest } = dto;
    await this.prisma.funilEtapa.update({
      where: { id: etapaId },
      data: {
        ...rest,
        ...(acaoSlaExpirado !== undefined
          ? {
              acaoSlaExpirado:
                acaoSlaExpirado === null
                  ? Prisma.JsonNull
                  : (acaoSlaExpirado as Prisma.InputJsonValue),
            }
          : {}),
      },
    });

    if (fragil.length > 0) {
      const alvo = fragil.map((c) => `"${c.fluxoNome}" (nó "${c.noTitulo}")`).join(', ');
      this.logger.warn(
        `Etapa "${etapa.nome}" → "${dto.nome}": ${fragil.length} condição(ões) comparam essa ` +
          `etapa por NOME e vão parar de casar em silêncio — ${alvo}. ` +
          `Troque o campo pra "lead.etapa_id" (valor: ${etapaId}).`,
      );
    }
    const funil = await this.findById(user, funilId);
    return fragil.length > 0
      ? {
          ...funil,
          avisos: fragil.map(
            (c) =>
              `⚠️ O fluxo "${c.fluxoNome}" tem uma condição (nó "${c.noTitulo}") que compara esta ` +
              `etapa pelo NOME antigo ("${etapa.nome}") — vai parar de casar SEM dar erro. ` +
              `Edite o nó pra usar o campo "lead.etapa_id" com o valor "${etapaId}".`,
          ),
        }
      : funil;
  }

  /**
   * Nós CONDICAO que comparam a etapa do lead pelo NOME (campo `lead.etapa_atual`).
   * São os frágeis a rename — ao contrário de MOVER_LEAD_ETAPA/CRIAR_LEAD, que
   * guardam o `funilEtapaId` e sobrevivem. Busca no JSON do nó (sem FK).
   */
  private async condicoesQueComparamPorNome(
    empresaId: string,
    nomeEtapa: string,
  ): Promise<Array<{ fluxoNome: string; noTitulo: string }>> {
    return this.prisma.$queryRaw<Array<{ fluxoNome: string; noTitulo: string }>>(Prisma.sql`
      SELECT f.nome AS "fluxoNome", fn.titulo AS "noTitulo"
      FROM "FluxoNo" fn
      JOIN "Fluxo" f ON f.id = fn."fluxoId"
      WHERE fn.tipo = 'CONDICAO'
        AND f."empresaId" = ${empresaId}
        AND f.status <> 'ARQUIVADO'
        AND (
          (fn."config" ->> 'campo' = 'lead.etapa_atual' AND fn."config" ->> 'valor' = ${nomeEtapa})
          OR (fn."config" ->> 'variavel' = 'lead.etapa_atual'
              AND fn."config"::text LIKE ${`%${nomeEtapa}%`})
        )
    `);
  }

  async removerEtapa(
    user: AuthenticatedUser,
    funilId: string,
    etapaId: string,
  ): Promise<FunilWithRel> {
    const funil = await this.findById(user, funilId);
    this.assertPodeEditar(user, funil);
    const etapa = funil.etapas.find((e) => e.id === etapaId);
    if (!etapa) throw new NotFoundException('Etapa', etapaId);

    // Etapa referenciada por fluxo (CRIAR_LEAD/MOVER_LEAD_ETAPA) NÃO pode sumir:
    // sem ela o nó falha ou o lead deixa de ser movido, e isso NÃO dá erro visível
    // — é a exata cilada que gerou o card 🔧 "Reestruturar as etapas dos 4 funis".
    if (etapa.fluxosQueApontam.length > 0) {
      const nomes = etapa.fluxosQueApontam.map((f) => f.nome).join(', ');
      throw new BusinessRuleException(
        `Etapa usada por ${etapa.fluxosQueApontam.length} fluxo(s) (${nomes}) — ` +
          'ajuste o(s) fluxo(s) pra apontar pra outra etapa antes de excluir.',
      );
    }

    // AUDITORIA (#29): o `leadsCount` vinha do findById — LIDO antes, e o delete
    // acontecia depois. Um lead que entrasse na etapa nessa janela (captura do
    // site, importação, bot movendo) era apagado junto: `Lead.etapaId` tem
    // onDelete SetNull, então o lead sumia do kanban sem erro nenhum. Mesmo
    // padrão do `remove`: re-conta DENTRO da transação, colado no delete.
    await this.prisma.$transaction(async (tx) => {
      const leads = await tx.lead.count({ where: { funilEtapaId: etapaId } });
      if (leads > 0) {
        throw new BusinessRuleException(
          `Etapa tem ${leads} lead(s) — mova-os pra outra etapa antes de excluir.`,
        );
      }
      await tx.funilEtapa.delete({ where: { id: etapaId } });
    });
    return this.findById(user, funilId);
  }

  async reordenarEtapas(
    user: AuthenticatedUser,
    funilId: string,
    dto: ReordenarEtapasDto,
  ): Promise<FunilWithRel> {
    const funil = await this.findById(user, funilId);
    this.assertPodeEditar(user, funil);
    // Duplicado na lista quebrava a bijeção: com o mesmo id 2x, o check de
    // tamanho passava e uma etapa REAL ficava de fora, com ordens colidindo.
    if (new Set(dto.etapaIds).size !== dto.etapaIds.length) {
      throw new BusinessRuleException('Lista de reordenação contém etapa duplicada');
    }
    const etapaIds = new Set(funil.etapas.map((e) => e.id));
    for (const id of dto.etapaIds) {
      if (!etapaIds.has(id)) {
        throw new BusinessRuleException(`Etapa ${id} não pertence a este funil`);
      }
    }
    if (dto.etapaIds.length !== funil.etapas.length) {
      throw new BusinessRuleException(
        'Lista de reordenação precisa conter todas as etapas do funil',
      );
    }
    await this.prisma.$transaction(
      dto.etapaIds.map((id, idx) =>
        this.prisma.funilEtapa.update({
          where: { id },
          data: { ordem: idx },
        }),
      ),
    );
    return this.findById(user, funilId);
  }
}
