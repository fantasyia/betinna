import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  CreateFunilDto,
  CreateFunilEtapaDto,
  ReordenarEtapasDto,
  UpdateFunilDto,
  UpdateFunilEtapaDto,
} from './funis.dto';

const funilInclude = {
  etapas: { orderBy: { ordem: 'asc' as const } },
  _count: { select: { leads: true } },
} satisfies Prisma.FunilInclude;

type FunilWithRel = Prisma.FunilGetPayload<{ include: typeof funilInclude }>;

@Injectable()
export class FunisService {
  private readonly logger = new Logger(FunisService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
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

    if (dto.isPadrao && !existing.isPadrao) {
      // Desmarca outros antes
      await this.prisma.funil.updateMany({
        where: { empresaId: existing.empresaId, isPadrao: true },
        data: { isPadrao: false },
      });
    }

    await this.prisma.funil.update({
      where: { id },
      data: dto,
    });
    return this.findById(user, id);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);

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
    await this.findById(user, funilId); // valida acesso
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
    await this.findById(user, funilId); // valida acesso
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
