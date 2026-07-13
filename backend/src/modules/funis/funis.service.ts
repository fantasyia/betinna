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

/** Lead resumido dentro de uma etapa (Demanda MCP `leads_por_etapa`). */
export interface LeadEtapaResumo {
  leadId: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  tags: string[];
  dataEntrada: string;
  representante: { id: string; nome: string } | null;
}

const funilInclude = {
  etapas: { orderBy: { ordem: 'asc' as const } },
  _count: { select: { leads: true } },
} satisfies Prisma.FunilInclude;

type FunilWithRel = Prisma.FunilGetPayload<{ include: typeof funilInclude }>;

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
    }));
    return buildPaginated(data, total, q.page, q.limit);
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
    return this.prisma.funil.findMany({
      where: { empresaId },
      orderBy: [{ isPadrao: 'desc' }, { ordem: 'asc' }, { nome: 'asc' }],
      include: funilInclude,
    });
  }

  async findById(user: AuthenticatedUser, id: string): Promise<FunilWithRel> {
    const empresaId = this.requireEmpresa(user);
    const funil = await this.prisma.funil.findFirst({
      where: { id, empresaId },
      include: funilInclude,
    });
    if (!funil) throw new NotFoundException('Funil', id);
    return funil;
  }

  async create(user: AuthenticatedUser, dto: CreateFunilDto): Promise<FunilWithRel> {
    const empresaId = this.requireEmpresa(user);

    // Se marcando este como padrão, desmarca os outros antes
    if (dto.isPadrao) {
      await this.prisma.funil.updateMany({
        where: { empresaId, isPadrao: true },
        data: { isPadrao: false },
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
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

    if (dto.isPadrao && !existing.isPadrao) {
      // Desmarca outros antes
      await this.prisma.funil.updateMany({
        where: { empresaId: existing.empresaId, isPadrao: true },
        data: { isPadrao: false },
      });
    }

    // tagsPermitidas é Json nullable — null explícito precisa de Prisma.JsonNull.
    const { tagsPermitidas, ...rest } = dto;
    await this.prisma.funil.update({
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
    return this.findById(user, id);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    // Funil protegido/obrigatório: rep não exclui.
    this.assertPodeEditar(user, existing);

    if (existing._count.leads > 0) {
      throw new BusinessRuleException(
        `Funil tem ${existing._count.leads} lead(s) — mova-os pra outro funil antes de excluir.`,
      );
    }
    if (existing.isPadrao) {
      // Permite excluir o padrão mas avisa pra ter outro funil
      const outros = await this.prisma.funil.count({
        where: { empresaId: existing.empresaId, id: { not: id } },
      });
      if (outros === 0) {
        throw new BusinessRuleException('Não pode excluir o único funil. Crie outro funil antes.');
      }
    }

    await this.prisma.funil.delete({ where: { id } });
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
    this.assertPodeEditar(user, await this.findById(user, funilId)); // valida acesso + proteção
    const etapa = await this.prisma.funilEtapa.findFirst({
      where: { id: etapaId, funilId },
    });
    if (!etapa) throw new NotFoundException('Etapa', etapaId);
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
    return this.findById(user, funilId);
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

    const leadsCount = await this.prisma.lead.count({
      where: { funilEtapaId: etapaId },
    });
    if (leadsCount > 0) {
      throw new BusinessRuleException(
        `Etapa tem ${leadsCount} lead(s) — mova-os pra outra etapa antes de excluir.`,
      );
    }
    await this.prisma.funilEtapa.delete({ where: { id: etapaId } });
    return this.findById(user, funilId);
  }

  async reordenarEtapas(
    user: AuthenticatedUser,
    funilId: string,
    dto: ReordenarEtapasDto,
  ): Promise<FunilWithRel> {
    const funil = await this.findById(user, funilId);
    this.assertPodeEditar(user, funil);
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
