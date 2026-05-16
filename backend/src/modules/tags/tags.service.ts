import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Tag } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { empresaFilter, getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { CreateTagDto, ListTagsDto, UpdateTagDto } from './tags.dto';

export interface TagWithCount extends Tag {
  _count: { clientes: number };
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

  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser, params: ListTagsDto): Promise<TagWithCount[]> {
    const where: Prisma.TagWhereInput = { ...empresaFilter(user) };
    if (params.search) {
      where.nome = { contains: params.search, mode: 'insensitive' };
    }
    return this.prisma.tag.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: { _count: { select: { clientes: true } } },
    });
  }

  async findById(user: AuthenticatedUser, id: string): Promise<TagWithCount> {
    // findFirst com empresaId filter (defesa em profundidade)
    const tag = await this.prisma.tag.findFirst({
      where: { id, ...empresaFilter(user) },
      include: { _count: { select: { clientes: true } } },
    });
    if (!tag) throw new NotFoundException('Tag', id);
    return tag;
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
    return this.prisma.tag.upsert({
      where: { empresaId_nome: { empresaId, nome } },
      create: { empresaId, nome },
      update: {},
    });
  }
}
