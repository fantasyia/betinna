import { Injectable, Logger } from '@nestjs/common';
import { type LeadEtapa, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
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

const leadInclude = {
  representante: { select: { id: true, nome: true, email: true } },
  cliente: { select: { id: true, nome: true } },
} satisfies Prisma.LeadInclude;

type LeadWithRel = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

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
   * View especial para o Kanban: agrupa todos os leads do usuário
   * por etapa, sem paginação (assume volume controlado).
   */
  async kanban(user: AuthenticatedUser): Promise<Record<LeadEtapa, LeadWithRel[]>> {
    const where = await this.baseWhere(user);
    const items = await this.prisma.lead.findMany({
      where,
      orderBy: { etapaDesde: 'desc' },
      include: leadInclude,
    });
    const out: Record<LeadEtapa, LeadWithRel[]> = {
      NOVO: [],
      QUALIFICANDO: [],
      PROPOSTA: [],
      NEGOCIACAO: [],
      GANHO: [],
      PERDIDO: [],
    };
    for (const lead of items) out[lead.etapa].push(lead);
    return out;
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

    const lead = await this.prisma.lead.create({
      data: {
        ...dto,
        representanteId,
        empresaId,
        etapaDesde: new Date(),
      },
      include: leadInclude,
    });

    // Trigger: LEAD_CRIADO
    void this.bus.disparar(empresaId, 'LEAD_CRIADO', {
      leadId: lead.id,
      lead: { id: lead.id, nome: lead.nome, etapa: lead.etapa, valorEstimado: lead.valorEstimado },
      clienteId: lead.clienteId,
      representanteId: lead.representanteId,
    });

    return lead;
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
    await this.prisma.lead.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: dto,
    });
    return this.prisma.lead.findUniqueOrThrow({ where: { id }, include: leadInclude });
  }

  async moverEtapa(user: AuthenticatedUser, id: string, dto: MoverEtapaDto): Promise<LeadWithRel> {
    const lead = await this.findById(user, id);
    const transicoesValidas = TRANSICOES_ETAPA[lead.etapa];
    if (!transicoesValidas.includes(dto.etapa)) {
      throw new BusinessRuleException(`Transição inválida: ${lead.etapa} → ${dto.etapa}`);
    }

    const data: Prisma.LeadUpdateInput = {
      etapa: dto.etapa,
      etapaDesde: new Date(),
    };
    if (dto.etapa === 'GANHO') {
      data.motivoGanho = dto.motivo;
      data.fechadoEm = new Date();
    }
    if (dto.etapa === 'PERDIDO') {
      data.motivoPerda = dto.motivo;
      data.fechadoEm = new Date();
    }
    // Reabrir lead perdido: limpa motivos e fechadoEm
    if (lead.etapa === 'PERDIDO' && dto.etapa === 'NOVO') {
      data.motivoPerda = null;
      data.motivoGanho = null;
      data.fechadoEm = null;
    }

    await this.prisma.lead.updateMany({
      where: { id, empresaId: lead.empresaId },
      data,
    });
    const updated = await this.prisma.lead.findUniqueOrThrow({
      where: { id },
      include: leadInclude,
    });
    this.logger.log(
      `Lead ${lead.id} movido ${lead.etapa} → ${dto.etapa}${dto.motivo ? ` (${dto.motivo})` : ''}`,
    );

    // Trigger: LEAD_ETAPA_MUDOU
    void this.bus.disparar(lead.empresaId, 'LEAD_ETAPA_MUDOU', {
      leadId: lead.id,
      lead: { id: lead.id, nome: lead.nome, etapaAnterior: lead.etapa, novaEtapa: dto.etapa },
      clienteId: lead.clienteId,
      representanteId: lead.representanteId,
      etapaAnterior: lead.etapa,
      novaEtapa: dto.etapa,
    });

    return updated;
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
      const valorTotal = g?._sum.valorEstimado ?? 0;
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
