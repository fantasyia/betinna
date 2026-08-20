import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Tag } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { empresaFilter, getCallerEmpresaId } from '@shared/utils/auth-context';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { CreateTagDto, ListTagsDto, UpdateTagDto } from './tags.dto';

export interface TagWithCount extends Tag {
  /** `leads` conta contatos/leads marcados — sem ele a tela de Tags mostrava só
   *  clientes e uma etiqueta com 3.000 leads aparecia como "0 usos". */
  _count: { clientes: number; leads: number };
}

/**
 * TagsService — tenant-scoped por design (auditoria 2026-05-15 P0).
 *
 * Antes da auditoria, `Tag.nome` era globalmente único e qualquer empresa
 * podia ver/usar tags de outra. Agora cada empresa tem seu próprio conjunto
 * com `@@unique([empresaId, nome])`.
 */
@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
  ) {}

  /**
   * Filtro de contagem POR CARTEIRA.
   *
   * O `_count` cru conta a empresa inteira: o rep via "cold — 30.282 usos", que
   * é o volume do ADMIN, não o trabalho dele. Com escopo, cada um vê o uso na
   * própria carteira (REP: os leads/clientes dele; GERENTE: os do time).
   * `null` (gestão) mantém a contagem cheia.
   */
  private async filtroDeUso(
    user: AuthenticatedUser,
  ): Promise<{ leads: object; clientes: object } | null> {
    const repIds = await this.repScope.getRepIds(user);
    if (repIds === null) return null;
    return {
      leads: { where: { lead: { representanteId: { in: repIds } } } },
      clientes: { where: { cliente: { representanteId: { in: repIds } } } },
    };
  }

  async list(user: AuthenticatedUser, params: ListTagsDto): Promise<TagWithCount[]> {
    const where: Prisma.TagWhereInput = { ...empresaFilter(user) };
    if (params.search) {
      where.nome = { contains: params.search, mode: 'insensitive' };
    }
    // REP só enxerga as tags marcadas pra ele. As operacionais (triagem,
    // e-mail mkt, gatilhos de fluxo) são trabalho da gestão e só poluíam a tela.
    if (user.role === 'REP') where.visivelParaRep = true;
    const escopo = await this.filtroDeUso(user);
    return this.prisma.tag.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: {
        _count: {
          select: escopo
            ? { clientes: escopo.clientes, leads: escopo.leads }
            : { clientes: true, leads: true },
        },
      },
    }) as unknown as Promise<TagWithCount[]>;
  }

  async findById(user: AuthenticatedUser, id: string): Promise<TagWithCount> {
    // findFirst com empresaId filter (defesa em profundidade)
    const escopo = await this.filtroDeUso(user);
    const tag = await this.prisma.tag.findFirst({
      where: {
        id,
        ...empresaFilter(user),
        ...(user.role === 'REP' ? { visivelParaRep: true } : {}),
      },
      include: {
        _count: {
          select: escopo
            ? { clientes: escopo.clientes, leads: escopo.leads }
            : { clientes: true, leads: true },
        },
      },
    });
    if (!tag) throw new NotFoundException('Tag', id);
    return tag as unknown as TagWithCount;
  }

  async create(user: AuthenticatedUser, dto: CreateTagDto): Promise<Tag> {
    // Tenant scope vem do JWT — nunca do body
    const empresaId = getCallerEmpresaId(user);
    try {
      return await this.prisma.tag.create({
        data: { ...dto, empresaId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BusinessRuleException(`Já existe tag com o nome "${dto.nome}" nesta empresa`);
      }
      throw err;
    }
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTagDto): Promise<Tag> {
    const existing = await this.findById(user, id);
    try {
      await this.prisma.tag.updateMany({ where: { id, empresaId: existing.empresaId }, data: dto });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BusinessRuleException(`Já existe tag com o nome "${dto.nome}" nesta empresa`);
      }
      throw err;
    }
    return this.prisma.tag.findUniqueOrThrow({ where: { id } });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    await this.prisma.tag.deleteMany({ where: { id, empresaId: existing.empresaId } });
  }

  /**
   * Helper interno — usado por FluxoExecutor.acaoMudarTag.
   * Upsert por (empresaId, nome) garantindo tenant scope.
   */
  async upsertByName(empresaId: string, nome: string): Promise<Tag> {
    // AUDITORIA #B16: o DTO de tag aplica trim + max(100), mas quem cria por AQUI
    // (fluxo/IA) passava direto — nascia tag com espaço na ponta (" VIP" ≠ "VIP",
    // duas linhas na lista de etiquetas) ou com um parágrafo inteiro cuspido pelo
    // modelo. Mesma normalização do `aplicarTagPorNome`, pra não divergirem.
    const limpo = nome.trim().slice(0, 100);
    if (!limpo) {
      throw new BusinessRuleException('Nome de etiqueta vazio');
    }
    return this.prisma.tag.upsert({
      where: { empresaId_nome: { empresaId, nome: limpo } },
      create: { empresaId, nome: limpo },
      update: {},
    });
  }
}
