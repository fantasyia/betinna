import { Injectable, Logger } from '@nestjs/common';
import { type LeadEtapa, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import type {
  AtribuirRepDto,
  CreateLeadDto,
  ListLeadsDto,
  MoverEtapaDto,
  UpdateLeadDto,
} from './leads.dto';
import { PROBABILIDADE_POR_ETAPA, SLA_DIAS_POR_ETAPA, TRANSICOES_ETAPA } from './leads.constants';
import { registrarTransicaoEtapa } from './lead-etapa-historico.util';
import { normalizarOrigemCadastro } from './atribuicao.util';

const leadInclude = {
  representante: { select: { id: true, nome: true, email: true } },
  cliente: { select: { id: true, nome: true } },
  funil: { select: { id: true, nome: true, cor: true } },
  funilEtapa: {
    select: { id: true, nome: true, cor: true, ordem: true, tipo: true, probabilidade: true },
  },
  tags: {
    include: { tag: { select: { id: true, nome: true, cor: true, categoria: true } } },
    orderBy: { criadoEm: 'asc' as const },
  },
} satisfies Prisma.LeadInclude;

type LeadWithRel = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

// PERF: o kanban carregava TODOS os leads do funil (findMany sem take) com leadInclude pesado —
// em funil com milhares de leads ativos, query gigante + payload grande + trava no drag (front).
// Teto global ordenado por etapaDesde desc (os mais recentes primeiro = "trabalho atual") + flag
// `truncado` pra UI avisar (não-silencioso). Cap por etapa/paginação por coluna = follow-up.
const KANBAN_CAP = 500;

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    private readonly bus: FluxoEventBusService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private async baseWhere(user: AuthenticatedUser): Promise<Prisma.LeadWhereInput> {
    const where: Prisma.LeadWhereInput = { empresaId: this.requireEmpresa(user) };
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) where.representanteId = { in: scope };
    return where;
  }

  async list(user: AuthenticatedUser, params: ListLeadsDto): Promise<Paginated<LeadWithRel>> {
    const where: Prisma.LeadWhereInput = { ...(await this.baseWhere(user)) };
    const conds: Prisma.LeadWhereInput[] = [];

    if (params.search) {
      conds.push({
        OR: [
          { nome: { contains: params.search, mode: 'insensitive' } },
          { cidade: { contains: params.search, mode: 'insensitive' } },
          { contatoNome: { contains: params.search, mode: 'insensitive' } },
          { contatoEmail: { contains: params.search, mode: 'insensitive' } },
        ],
      });
    }
    if (params.etapa) conds.push({ etapa: params.etapa });
    if (params.canalOrigem) conds.push({ canalOrigem: params.canalOrigem });
    if (params.representanteId) conds.push({ representanteId: params.representanteId });
    if (params.aging) {
      // Aging: leads não fechados cuja etapaDesde passou do SLA da etapa
      // Implementado como OR por etapa pra simplificar (sem post-process)
      const agora = new Date();
      const agingConds: Prisma.LeadWhereInput[] = (
        ['NOVO', 'QUALIFICANDO', 'PROPOSTA', 'NEGOCIACAO'] as LeadEtapa[]
      ).map((etapa) => ({
        etapa,
        etapaDesde: {
          lte: new Date(agora.getTime() - SLA_DIAS_POR_ETAPA[etapa] * 24 * 60 * 60 * 1000),
        },
      }));
      conds.push({ OR: agingConds });
    }
    if (conds.length > 0) where.AND = conds;

    const [total, data] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { [params.sortBy]: params.sortOrder },
        include: leadInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  /**
   * View especial para o Kanban — agrupa leads por etapa.
   *
   * Quando `funilId` é informado, retorna agrupamento por FunilEtapa.id
   * (formato dinâmico). Senão, agrupa pelo enum legado.
   *
   * Resposta inclui também as etapas (com cor/ordem/tipo) pra que o
   * frontend renderize colunas customizadas sem fazer round-trip extra.
   */
  async kanban(
    user: AuthenticatedUser,
    funilId?: string,
  ): Promise<{
    funil: {
      id: string | null;
      nome: string;
      cor: string;
      etapas: Array<{
        id: string;
        nome: string;
        cor: string;
        ordem: number;
        tipo: 'ATIVA' | 'GANHO' | 'PERDIDO';
        probabilidade: number;
      }>;
    };
    /** Mapa etapaId → leads. Quando enum legado, a key é o nome do enum. */
    grupos: Record<string, LeadWithRel[]>;
    /** true quando atingiu KANBAN_CAP — a UI deve avisar que há mais leads não exibidos. */
    truncado: boolean;
  }> {
    const empresaId = this.requireEmpresa(user);
    const where = await this.baseWhere(user);

    // Resolve o funil-alvo: explícito > padrão da empresa
    let funil = funilId
      ? await this.prisma.funil.findFirst({
          where: { id: funilId, empresaId },
          include: { etapas: { orderBy: { ordem: 'asc' } } },
        })
      : null;
    if (!funil) {
      funil = await this.prisma.funil.findFirst({
        where: { empresaId, isPadrao: true, ativo: true },
        include: { etapas: { orderBy: { ordem: 'asc' } } },
      });
    }
    if (!funil) {
      // Empresa sem funis ainda — pega o primeiro disponível
      funil = await this.prisma.funil.findFirst({
        where: { empresaId, ativo: true },
        include: { etapas: { orderBy: { ordem: 'asc' } } },
      });
    }

    if (funil) {
      // Filtra leads desse funil + agrupa por funilEtapaId
      const items = await this.prisma.lead.findMany({
        where: { ...where, funilId: funil.id },
        orderBy: { etapaDesde: 'desc' },
        include: leadInclude,
        take: KANBAN_CAP,
      });
      const truncado = items.length >= KANBAN_CAP;
      if (truncado) {
        this.logger.warn(
          `Kanban truncado em ${KANBAN_CAP} leads (funil ${funil.id}) — UI deve avisar.`,
        );
      }
      const grupos: Record<string, LeadWithRel[]> = Object.fromEntries(
        funil.etapas.map((e) => [e.id, [] as LeadWithRel[]]),
      );
      for (const lead of items) {
        const key = lead.funilEtapaId ?? funil.etapas[0]?.id;
        if (key && grupos[key]) grupos[key].push(lead);
      }
      return {
        funil: {
          id: funil.id,
          nome: funil.nome,
          cor: funil.cor,
          etapas: funil.etapas.map((e) => ({
            id: e.id,
            nome: e.nome,
            cor: e.cor,
            ordem: e.ordem,
            tipo: e.tipo,
            probabilidade: e.probabilidade,
          })),
        },
        grupos,
        truncado,
      };
    }

    // Fallback: empresa sem funil → usa enum legado, formato similar
    const items = await this.prisma.lead.findMany({
      where,
      orderBy: { etapaDesde: 'desc' },
      include: leadInclude,
      take: KANBAN_CAP,
    });
    const truncado = items.length >= KANBAN_CAP;
    if (truncado) {
      this.logger.warn(`Kanban (legado) truncado em ${KANBAN_CAP} leads — UI deve avisar.`);
    }
    const ENUM_ETAPAS: LeadEtapa[] = [
      'NOVO',
      'QUALIFICANDO',
      'PROPOSTA',
      'NEGOCIACAO',
      'GANHO',
      'PERDIDO',
    ];
    const grupos: Record<string, LeadWithRel[]> = Object.fromEntries(
      ENUM_ETAPAS.map((e) => [e, [] as LeadWithRel[]]),
    );
    for (const lead of items) grupos[lead.etapa].push(lead);
    return {
      funil: {
        id: null,
        nome: 'Funil Padrão (legado)',
        cor: '#201554',
        etapas: ENUM_ETAPAS.map((nome, ordem) => ({
          id: nome,
          nome,
          cor: '#7c3aed',
          ordem,
          tipo: nome === 'GANHO' ? 'GANHO' : nome === 'PERDIDO' ? 'PERDIDO' : 'ATIVA',
          probabilidade: 50,
        })),
      },
      grupos,
      truncado,
    };
  }

  async findById(user: AuthenticatedUser, id: string): Promise<LeadWithRel> {
    const lead = await this.prisma.lead.findFirst({
      where: { id, ...(await this.baseWhere(user)) },
      include: leadInclude,
    });
    if (!lead) throw new NotFoundException('Lead', id);
    return lead;
  }

  async create(user: AuthenticatedUser, dto: CreateLeadDto): Promise<LeadWithRel> {
    const empresaId = this.requireEmpresa(user);
    let representanteId = dto.representanteId ?? null;
    if (user.role === 'REP') representanteId = user.id;
    if (representanteId) {
      await this.assertRepValido(empresaId, representanteId);
    }

    // `semFunil` sai do spread (não é coluna do Lead) e força funil nulo:
    // contato solto, fora de qualquer funil/cron (importação de base fria).
    // `origemCadastro` também sai: é normalizado/validado por lista abaixo.
    const { semFunil, origemCadastro: origemInformada, ...dadosLead } = dto;
    // Porta de entrada: quem chama SEM informar é o cadastro autenticado (rep/admin
    // criando na mão) → "manual_rep". A importação em massa passa "importacao".
    // Nunca fica nulo — é o que separa "sem UTM porque foi manual" de "rastreio quebrado".
    const origemCadastro = normalizarOrigemCadastro(origemInformada, 'manual_rep');

    // Resolve funil + etapa inicial. Se o user não informou funil, usa o
    // padrão da empresa. Se a etapa-inicial específica não foi pedida,
    // pega a primeira etapa ATIVA na ordem. `semFunil` pula tudo isso.
    const { funilId, funilEtapaId } = semFunil
      ? { funilId: null, funilEtapaId: null }
      : await this.resolverFunilInicial(empresaId, dto.funilId, dto.funilEtapaId, dto.etapa);

    const lead = await this.prisma.lead
      .create({
        data: {
          ...dadosLead,
          representanteId,
          empresaId,
          funilId,
          funilEtapaId,
          origemCadastro,
          etapaDesde: new Date(),
        },
        include: leadInclude,
      })
      .catch((err: unknown) => {
        // Índice único (empresaId, LOWER(contatoEmail)): pessoa já é lead →
        // erro CLARO em vez de 500 (regra do produto: 1 lead por pessoa/empresa).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Já existe um lead com este e-mail nesta empresa');
        }
        throw err;
      });

    // Histórico: entrada inicial no funil (origem null). Irreversível.
    await registrarTransicaoEtapa(this.prisma, this.logger, {
      empresaId,
      leadId: lead.id,
      funilId,
      etapaOrigem: null,
      etapaDestino: funilEtapaId ?? lead.etapa,
      quem: user.id,
      origemMudanca: 'criacao',
    });

    // Trigger: LEAD_CRIADO
    void this.bus.disparar(empresaId, 'LEAD_CRIADO', {
      leadId: lead.id,
      lead: {
        id: lead.id,
        nome: lead.nome,
        etapa: lead.etapa,
        valorEstimado: Number(lead.valorEstimado),
      },
      clienteId: lead.clienteId,
      representanteId: lead.representanteId,
    });

    return lead;
  }

  /**
   * Criação SISTÊMICA de lead (captura pública do site — sem usuário logado).
   * Mesmo caminho do create(): resolve funil/etapa inicial e dispara LEAD_CRIADO
   * (fluxos com esse gatilho reagem normalmente ao lead vindo do site).
   */
  async createPublico(
    empresaId: string,
    dto: {
      nome: string;
      contatoNome?: string;
      contatoTelefone?: string;
      contatoEmail?: string;
      cidade?: string;
      uf?: string;
      segmento?: string;
      observacoes?: string;
      funilId?: string;
      funilEtapaId?: string;
      /** Campos estruturados extras da captura → Lead.variaveis (lidos nos fluxos). */
      variaveis?: Record<string, unknown>;
      /** Atribuição de marketing — colunas indexáveis do 1º toque. */
      utmSource?: string | null;
      utmMedium?: string | null;
      utmCampaign?: string | null;
      origemCadastro?: string | null;
      formularioOrigem?: string | null;
    },
  ): Promise<{ id: string }> {
    const { funilId, funilEtapaId } = await this.resolverFunilInicial(
      empresaId,
      dto.funilId,
      dto.funilEtapaId,
      undefined,
    );

    const lead = await this.prisma.lead.create({
      data: {
        empresaId,
        nome: dto.nome,
        contatoNome: dto.contatoNome ?? null,
        contatoTelefone: dto.contatoTelefone ?? null,
        contatoEmail: dto.contatoEmail ?? null,
        cidade: dto.cidade ?? null,
        uf: dto.uf ?? null,
        segmento: dto.segmento ?? null,
        observacoes: dto.observacoes ?? null,
        canalOrigem: 'SITE',
        funilId,
        funilEtapaId,
        etapaDesde: new Date(),
        utmSource: dto.utmSource ?? null,
        utmMedium: dto.utmMedium ?? null,
        utmCampaign: dto.utmCampaign ?? null,
        origemCadastro: dto.origemCadastro ?? null,
        formularioOrigem: dto.formularioOrigem ?? null,
        ...(dto.variaveis !== undefined
          ? { variaveis: dto.variaveis as Prisma.InputJsonValue }
          : {}),
      },
      select: { id: true, nome: true, etapa: true, valorEstimado: true },
    });

    // Histórico: entrada inicial no funil (sistema — sem usuário logado).
    await registrarTransicaoEtapa(this.prisma, this.logger, {
      empresaId,
      leadId: lead.id,
      funilId,
      etapaOrigem: null,
      etapaDestino: funilEtapaId ?? lead.etapa,
      quem: null,
      origemMudanca: 'criacao',
    });

    void this.bus.disparar(empresaId, 'LEAD_CRIADO', {
      leadId: lead.id,
      lead: {
        id: lead.id,
        nome: lead.nome,
        etapa: lead.etapa,
        valorEstimado: Number(lead.valorEstimado),
      },
      clienteId: null,
      representanteId: null,
    });

    return { id: lead.id };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateLeadDto): Promise<LeadWithRel> {
    const existing = await this.findById(user, id);
    if (existing.etapa === 'GANHO' || existing.etapa === 'PERDIDO') {
      throw new BusinessRuleException(
        'Lead fechado não pode ser editado. Reabra movendo-o para outra etapa primeiro.',
      );
    }
    if (dto.representanteId) {
      await this.assertRepValido(existing.empresaId, dto.representanteId);
    }
    // Cross-tenant: funilId/funilEtapaId chegam como string livre no DTO — valida que
    // pertencem à empresa do lead ANTES de gravar (senão dá pra mover o lead pra um
    // funil/etapa de OUTRA empresa). Espelha o guard de moverEtapa().
    if (dto.funilEtapaId) {
      const et = await this.prisma.funilEtapa.findFirst({
        where: { id: dto.funilEtapaId, funil: { empresaId: existing.empresaId } },
        select: { id: true, funilId: true },
      });
      if (!et) throw new BusinessRuleException('Etapa de destino inválida');
      // COERÊNCIA (P0): se o funil também veio no DTO, a etapa TEM que ser dele —
      // senão o lead fica com funilId de um funil e etapa de outro → some do kanban.
      if (dto.funilId && et.funilId !== dto.funilId) {
        throw new BusinessRuleException('A etapa informada não pertence ao funil informado');
      }
      // Etapa sem funil explícito: o funilId do lead acompanha a etapa (evita
      // deixar um funilId antigo incoerente com a nova etapa).
      if (!dto.funilId) dto.funilId = et.funilId;
    }
    if (dto.funilId) {
      const f = await this.prisma.funil.findFirst({
        where: { id: dto.funilId, empresaId: existing.empresaId },
        select: { id: true },
      });
      if (!f) throw new BusinessRuleException('Funil inválido');
      // CAÇADA-BUG #35: mover SÓ o funil (sem etapa) mantinha o `funilEtapaId` do funil ANTIGO → no
      // kanban do funil novo `grupos[lead.funilEtapaId]` não existe e o lead SOME de todos os kanbans.
      // Sem etapa explícita, cai na 1ª etapa ATIVA do funil novo (mesmo default do create).
      if (!dto.funilEtapaId) {
        const primeira = await this.prisma.funilEtapa.findFirst({
          where: { funilId: dto.funilId, tipo: 'ATIVA' },
          orderBy: { ordem: 'asc' },
          select: { id: true },
        });
        if (!primeira) {
          throw new BusinessRuleException('O funil de destino não tem etapa ativa');
        }
        dto.funilEtapaId = primeira.id;
      }
    }
    await this.prisma.lead.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: dto,
    });
    // Histórico: o update também pode mover de etapa (form de edição do lead com
    // funil/etapa). Só registra quando a etapa REALMENTE muda.
    if (dto.funilEtapaId && dto.funilEtapaId !== existing.funilEtapaId) {
      await registrarTransicaoEtapa(this.prisma, this.logger, {
        empresaId: existing.empresaId,
        leadId: id,
        funilId: dto.funilId ?? existing.funilId,
        etapaOrigem: existing.funilEtapaId ?? existing.etapa,
        etapaDestino: dto.funilEtapaId,
        quem: user.id,
        origemMudanca: 'manual',
      });
    }
    return this.prisma.lead.findUniqueOrThrow({ where: { id }, include: leadInclude });
  }

  /** Calcula quando vence o SLA de uma etapa (slaHoras tem precedência). Fase C. */
  private async calcularProximoSla(funilEtapaId?: string | null): Promise<Date | null> {
    if (!funilEtapaId) return null;
    const etapa = await this.prisma.funilEtapa.findUnique({
      where: { id: funilEtapaId },
      select: { slaHoras: true, slaDias: true },
    });
    if (!etapa) return null;
    const d = new Date();
    if (etapa.slaHoras) {
      d.setHours(d.getHours() + etapa.slaHoras);
      return d;
    }
    if (etapa.slaDias) {
      d.setDate(d.getDate() + etapa.slaDias);
      return d;
    }
    return null;
  }

  async moverEtapa(user: AuthenticatedUser, id: string, dto: MoverEtapaDto): Promise<LeadWithRel> {
    const lead = await this.findById(user, id);

    // 2 caminhos: funil custom (funilEtapaId) OU enum legado (etapa).
    // Caminho custom é preferido quando informado.
    let novaEtapaEnum: LeadEtapa;
    let novoFunilEtapaId: string | null = lead.funilEtapaId;
    let novoFunilId: string | null = lead.funilId;
    const deFunilEtapaId: string | null = lead.funilEtapaId; // origem (antes do move)
    let etapaTipo: 'ATIVA' | 'GANHO' | 'PERDIDO' = 'ATIVA';

    if (dto.funilEtapaId) {
      const novaEtapa = await this.prisma.funilEtapa.findFirst({
        where: { id: dto.funilEtapaId },
        include: { funil: { select: { id: true, empresaId: true } } },
      });
      if (!novaEtapa || novaEtapa.funil.empresaId !== lead.empresaId) {
        throw new BusinessRuleException('Etapa de destino inválida');
      }
      // Lead muda de funil se a etapa pertencer a outro funil
      novoFunilEtapaId = novaEtapa.id;
      novoFunilId = novaEtapa.funil.id;
      etapaTipo = novaEtapa.tipo;
      // Mapeia o tipo da etapa pro enum legado pra manter compat
      novaEtapaEnum =
        novaEtapa.tipo === 'GANHO'
          ? 'GANHO'
          : novaEtapa.tipo === 'PERDIDO'
            ? 'PERDIDO'
            : // Heurística: ATIVA mapeia conforme ordem (0=NOVO, 1=QUAL, 2=PROP, 3+=NEGO)
              novaEtapa.ordem === 0
              ? 'NOVO'
              : novaEtapa.ordem === 1
                ? 'QUALIFICANDO'
                : novaEtapa.ordem === 2
                  ? 'PROPOSTA'
                  : 'NEGOCIACAO';
    } else if (dto.etapa) {
      // Caminho legado — valida transição do enum
      const transicoesValidas = TRANSICOES_ETAPA[lead.etapa];
      if (!transicoesValidas.includes(dto.etapa)) {
        throw new BusinessRuleException(`Transição inválida: ${lead.etapa} → ${dto.etapa}`);
      }
      novaEtapaEnum = dto.etapa;
      etapaTipo = dto.etapa === 'GANHO' ? 'GANHO' : dto.etapa === 'PERDIDO' ? 'PERDIDO' : 'ATIVA';
    } else {
      throw new BusinessRuleException('Informe `etapa` ou `funilEtapaId`');
    }

    // CAÇADA-BUG #36: mover pra a MESMA etapa é NO-OP. Sem este guard, o update zerava `etapaDesde`
    // (relógio de SLA/aging) e disparava LEAD_ETAPA_MUDOU com de===para → re-disparava o fluxo de
    // abordagem, e o supersede anti-dup da IA cancelava a conversa em andamento e reabria o opener.
    // O executor de fluxos já tinha esse guard; o service não. Retorna o lead como está.
    const mesmaEtapa = dto.funilEtapaId
      ? novoFunilEtapaId === lead.funilEtapaId
      : novaEtapaEnum === lead.etapa;
    if (mesmaEtapa) {
      return this.prisma.lead.findUniqueOrThrow({ where: { id }, include: leadInclude });
    }

    // Motivo obrigatório pra GANHO/PERDIDO (validação espelhada do DTO mas
    // re-checada aqui pra cobrir o caminho funilEtapaId).
    if ((etapaTipo === 'GANHO' || etapaTipo === 'PERDIDO') && !dto.motivo) {
      throw new BusinessRuleException(
        `Motivo é obrigatório ao marcar como ${etapaTipo === 'GANHO' ? 'Ganho' : 'Perdido'}`,
      );
    }

    // ⚠️ updateMany (escopo de tenant — auditoria 2026-05-15) NÃO aceita writes de
    // relação (`funilEtapa: { connect }`). Usamos os FKs ESCALARES direto, igual o
    // LIBERAR_LOTE faz — senão o Prisma rejeita com "validation error".
    const data: Prisma.LeadUncheckedUpdateManyInput = {
      etapa: novaEtapaEnum,
      etapaDesde: new Date(),
      // Fase C (spec §4) — quando vence o SLA da etapa de destino.
      proximoSlaEm: await this.calcularProximoSla(novoFunilEtapaId),
    };
    if (novoFunilEtapaId !== lead.funilEtapaId) {
      data.funilEtapaId = novoFunilEtapaId;
    }
    // Se a etapa-destino é de outro funil, atualiza o funilId escalar também
    // (senão o lead fica com funilEtapaId de um funil e funilId de outro).
    if (novoFunilId !== lead.funilId) {
      data.funilId = novoFunilId;
    }
    if (etapaTipo === 'GANHO') {
      data.motivoGanho = dto.motivo;
      data.fechadoEm = new Date();
      // valorFechado (usado no atribuicao_por_campanha): proxy = valorEstimado no
      // momento do ganho (não há campo dedicado de valor real ainda; refino futuro
      // = puxar do Pedido vinculado). Só grava se ainda não tinha valor fechado.
      data.valorFechado = lead.valorEstimado;
    }
    if (etapaTipo === 'PERDIDO') {
      data.motivoPerda = dto.motivo;
      data.fechadoEm = new Date();
    }
    // Reabrir lead fechado: limpa motivos, fechadoEm e valor fechado.
    if ((lead.etapa === 'PERDIDO' || lead.etapa === 'GANHO') && etapaTipo === 'ATIVA') {
      data.motivoPerda = null;
      data.motivoGanho = null;
      data.fechadoEm = null;
      data.valorFechado = null;
    }

    // CAS: inclui a etapa (e o funilEtapaId) de origem no where. Duas transições
    // concorrentes a partir da mesma origem (ex.: GANHO vs PERDIDO) não se sobrepõem —
    // só a 1ª casa count===1; a 2ª aborta sem last-write-wins nem trigger fantasma.
    const cas = await this.prisma.lead.updateMany({
      where: { id, empresaId: lead.empresaId, etapa: lead.etapa, funilEtapaId: lead.funilEtapaId },
      data,
    });
    if (cas.count === 0) {
      throw new BusinessRuleException('Lead mudou de etapa — recarregue e tente novamente');
    }
    const updated = await this.prisma.lead.findUniqueOrThrow({
      where: { id },
      include: leadInclude,
    });
    this.logger.log(
      `Lead ${lead.id} movido ${lead.etapa} → ${novaEtapaEnum}${dto.motivo ? ` (${dto.motivo})` : ''}`,
    );

    // Histórico: transição manual (cobre UI, API e acaoMassa em lote, que reusa
    // este método). Prioriza o funilEtapaId; cai no enum quando não há funil custom.
    await registrarTransicaoEtapa(this.prisma, this.logger, {
      empresaId: lead.empresaId,
      leadId: lead.id,
      funilId: novoFunilId,
      etapaOrigem: deFunilEtapaId ?? lead.etapa,
      etapaDestino: novoFunilEtapaId ?? novaEtapaEnum,
      quem: user.id,
      origemMudanca: 'manual',
    });

    // Trigger: LEAD_ETAPA_MUDOU — só a transição vencedora (count===1) dispara, com o
    // payload refletindo a transição realmente aplicada.
    void this.bus.disparar(lead.empresaId, 'LEAD_ETAPA_MUDOU', {
      leadId: lead.id,
      lead: {
        id: lead.id,
        nome: lead.nome,
        etapaAnterior: lead.etapa,
        novaEtapa: novaEtapaEnum,
      },
      clienteId: lead.clienteId,
      representanteId: lead.representanteId,
      etapaAnterior: lead.etapa,
      novaEtapa: novaEtapaEnum,
      // ids reais (FunilEtapa/Funil) — o gatilho filtra por estes.
      funilId: novoFunilId,
      paraFunilEtapaId: novoFunilEtapaId,
      deFunilEtapaId,
    });

    return updated;
  }

  // ─── Funil resolver ──────────────────────────────────────────────
  /**
   * Determina funilId + funilEtapaId iniciais pra um novo lead.
   *
   * Prioridade:
   *  1. Se `funilEtapaId` foi explícito → usa ele (deriva funilId do parent)
   *  2. Se `funilId` foi explícito → usa ele + 1ª etapa ATIVA na ordem
   *  3. Senão → usa funil padrão da empresa (isPadrao=true) + 1ª etapa ATIVA
   *
   * Se a empresa ainda não tem nenhum funil (caso extremo de seed novo),
   * retorna null pra ambos — o lead fica com só o enum legado.
   */
  private async resolverFunilInicial(
    empresaId: string,
    funilIdInput: string | undefined,
    funilEtapaIdInput: string | undefined,
    etapaEnum: LeadEtapa | undefined,
  ): Promise<{ funilId: string | null; funilEtapaId: string | null }> {
    if (funilEtapaIdInput) {
      const etapa = await this.prisma.funilEtapa.findFirst({
        where: { id: funilEtapaIdInput, funil: { empresaId } },
        select: { id: true, funilId: true },
      });
      if (!etapa) {
        throw new BusinessRuleException('FunilEtapa inválida ou de outra empresa');
      }
      return { funilId: etapa.funilId, funilEtapaId: etapa.id };
    }

    let funilId: string | null = null;
    if (funilIdInput) {
      // SEGURANÇA (P0): valida que o funil informado é DESTA empresa. Sem isso, o
      // create (inclusive a captura pública /public/leads, que aceita funilId no
      // payload) criava lead apontando pro funil de OUTRO tenant → lead sumia do
      // kanban. Espelha a validação do caminho de funilEtapaId acima.
      const f = await this.prisma.funil.findFirst({
        where: { id: funilIdInput, empresaId },
        select: { id: true },
      });
      if (!f) throw new BusinessRuleException('Funil inválido ou de outra empresa');
      funilId = f.id;
    } else {
      const padrao = await this.prisma.funil.findFirst({
        where: { empresaId, isPadrao: true, ativo: true },
        select: { id: true },
      });
      funilId = padrao?.id ?? null;
    }
    if (!funilId) return { funilId: null, funilEtapaId: null };

    // Pega a etapa correspondente ao enum (ou a 1ª ATIVA)
    const etapas = await this.prisma.funilEtapa.findMany({
      where: { funilId },
      orderBy: { ordem: 'asc' },
    });
    if (etapas.length === 0) return { funilId, funilEtapaId: null };

    // Tenta mapear o enum recebido pra etapa correspondente
    let etapaDestino = etapas.find((e) => e.tipo === 'ATIVA');
    if (etapaEnum === 'GANHO') {
      etapaDestino = etapas.find((e) => e.tipo === 'GANHO') ?? etapaDestino;
    } else if (etapaEnum === 'PERDIDO') {
      etapaDestino = etapas.find((e) => e.tipo === 'PERDIDO') ?? etapaDestino;
    }
    return { funilId, funilEtapaId: etapaDestino?.id ?? etapas[0].id };
  }

  async atribuirRep(
    user: AuthenticatedUser,
    id: string,
    dto: AtribuirRepDto,
  ): Promise<LeadWithRel> {
    const lead = await this.findById(user, id);
    if (dto.representanteId) {
      await this.assertRepValido(lead.empresaId, dto.representanteId);
    }
    await this.prisma.lead.updateMany({
      where: { id, empresaId: lead.empresaId },
      data: { representanteId: dto.representanteId },
    });
    return this.prisma.lead.findUniqueOrThrow({ where: { id }, include: leadInclude });
  }

  // ─── Tags do lead (orquestração Fase B) ──────────────────────────

  /** Aplica uma tag existente (por id) ao lead. Idempotente. */
  async adicionarTag(
    user: AuthenticatedUser,
    leadId: string,
    tagId: string,
    origem: 'usuario' | 'ia' = 'usuario',
  ): Promise<LeadWithRel> {
    const empresaId = this.requireEmpresa(user);
    const lead = await this.findById(user, leadId); // valida tenant + escopo do rep
    const tag = await this.prisma.tag.findFirst({
      where: { id: tagId, empresaId },
      select: { id: true, nome: true },
    });
    if (!tag) throw new NotFoundException('Tag', tagId);

    // Allow-list de tags por funil (Fase C — spec §2.1).
    if (lead.funilId) {
      const funil = await this.prisma.funil.findUnique({
        where: { id: lead.funilId },
        select: { tagsPermitidas: true },
      });
      const permitidas = funil?.tagsPermitidas;
      if (Array.isArray(permitidas) && permitidas.length > 0 && !permitidas.includes(tag.nome)) {
        throw new BusinessRuleException(`A tag "${tag.nome}" não é permitida no funil deste lead`);
      }
    }

    await this.prisma.leadTag.upsert({
      where: { leadId_tagId: { leadId, tagId } },
      create: { leadId, tagId, origem },
      update: {},
    });
    // Gatilho de fluxo "Lead recebeu tag" (best-effort).
    await this.bus.disparar(empresaId, 'LEAD_RECEBEU_TAG', { leadId, tagId });
    return this.findById(user, leadId);
  }

  /** Remove uma tag do lead. */
  async removerTag(user: AuthenticatedUser, leadId: string, tagId: string): Promise<LeadWithRel> {
    await this.findById(user, leadId);
    await this.prisma.leadTag.deleteMany({ where: { leadId, tagId } });
    return this.findById(user, leadId);
  }

  /**
   * Aplica tag por NOME (cria a tag se não existir) — usado por fluxos/IA
   * (nó "Conversar com IA" classifica → grava tag de mesmo nome). Tenant-scoped.
   * Não passa por escopo de rep (chamado pelo motor, não por usuário).
   */
  async aplicarTagPorNome(
    empresaId: string,
    leadId: string,
    nome: string,
    origem: 'usuario' | 'ia' = 'ia',
  ): Promise<void> {
    const tag = await this.prisma.tag.upsert({
      where: { empresaId_nome: { empresaId, nome } },
      create: { empresaId, nome },
      update: {},
    });
    await this.prisma.leadTag.upsert({
      where: { leadId_tagId: { leadId, tagId: tag.id } },
      create: { leadId, tagId: tag.id, origem },
      update: {},
    });
    await this.bus.disparar(empresaId, 'LEAD_RECEBEU_TAG', { leadId, tagId: tag.id });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    await this.prisma.lead.deleteMany({ where: { id, empresaId: existing.empresaId } });
  }

  /**
   * Resumo do pipeline da empresa do usuário.
   * Útil pra dashboard executivo.
   */
  async resumoPipeline(user: AuthenticatedUser): Promise<{
    porEtapa: Array<{
      etapa: LeadEtapa;
      quantidade: number;
      valorTotal: number;
      probabilidade: number;
      ponderado: number;
    }>;
    pipelineTotal: number;
    pipelinePonderado: number;
    aging: number;
  }> {
    const where = await this.baseWhere(user);
    const grouped = await this.prisma.lead.groupBy({
      by: ['etapa'],
      where,
      _count: { _all: true },
      _sum: { valorEstimado: true },
    });
    const porEtapa = (
      ['NOVO', 'QUALIFICANDO', 'PROPOSTA', 'NEGOCIACAO', 'GANHO', 'PERDIDO'] as LeadEtapa[]
    ).map((etapa) => {
      const g = grouped.find((x) => x.etapa === etapa);
      const valorTotal = Number(g?._sum.valorEstimado ?? 0);
      const probabilidade = PROBABILIDADE_POR_ETAPA[etapa];
      return {
        etapa,
        quantidade: g?._count._all ?? 0,
        valorTotal,
        probabilidade,
        ponderado: Math.round(valorTotal * (probabilidade / 100) * 100) / 100,
      };
    });
    const ativas = porEtapa.filter((p) => p.etapa !== 'GANHO' && p.etapa !== 'PERDIDO');
    const pipelineTotal = ativas.reduce((s, p) => s + p.valorTotal, 0);
    const pipelinePonderado = ativas.reduce((s, p) => s + p.ponderado, 0);

    // Conta leads em aging
    const agora = new Date();
    const agingConds: Prisma.LeadWhereInput[] = (
      ['NOVO', 'QUALIFICANDO', 'PROPOSTA', 'NEGOCIACAO'] as LeadEtapa[]
    ).map((etapa) => ({
      etapa,
      etapaDesde: {
        lte: new Date(agora.getTime() - SLA_DIAS_POR_ETAPA[etapa] * 24 * 60 * 60 * 1000),
      },
    }));
    const aging = await this.prisma.lead.count({
      where: { ...where, AND: [{ OR: agingConds }] },
    });

    return { porEtapa, pipelineTotal, pipelinePonderado, aging };
  }

  private async assertRepValido(empresaId: string, repId: string): Promise<void> {
    const rep = await this.prisma.usuario.findFirst({
      where: {
        id: repId,
        role: 'REP',
        status: 'ATIVO',
        empresas: { some: { empresaId } },
      },
      select: { id: true },
    });
    if (!rep) {
      throw new BusinessRuleException('Representante inválido, inativo ou não vinculado à empresa');
    }
  }
}
