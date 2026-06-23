import { Injectable } from '@nestjs/common';
import type { KnowledgeChunk, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import { IndexacaoService } from './indexacao.service';
import type { CreateKnowledgeDto, ListKnowledgeDto, UpdateKnowledgeDto } from './knowledge.dto';

/**
 * Base de conhecimento da empresa (KnowledgeChunk) — CRUD do conteúdo MANUAL
 * (FAQ/condições/políticas). Cada escrita reenfileira a indexação semântica.
 * Os chunks fonte=CONFIG são gerados pelo KnowledgeConfigService (read-only aqui).
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexacao: IndexacaoService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  async list(
    user: AuthenticatedUser,
    params: ListKnowledgeDto,
  ): Promise<Paginated<KnowledgeChunk>> {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.KnowledgeChunkWhereInput = { empresaId };
    if (!params.incluirConfig) where.fonte = 'MANUAL';
    if (params.search) {
      where.OR = [
        { titulo: { contains: params.search, mode: 'insensitive' } },
        { conteudo: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    const [total, data] = await Promise.all([
      this.prisma.knowledgeChunk.count({ where }),
      this.prisma.knowledgeChunk.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { atualizadoEm: 'desc' },
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<KnowledgeChunk> {
    const chunk = await this.prisma.knowledgeChunk.findFirst({
      where: { id, empresaId: this.requireEmpresa(user) },
    });
    if (!chunk) throw new NotFoundException('Conhecimento', id);
    return chunk;
  }

  async create(user: AuthenticatedUser, dto: CreateKnowledgeDto): Promise<KnowledgeChunk> {
    const empresaId = this.requireEmpresa(user);
    const chunk = await this.prisma.knowledgeChunk.create({
      data: {
        empresaId,
        fonte: 'MANUAL',
        titulo: dto.titulo,
        conteudo: dto.conteudo,
        categoria: dto.categoria,
        ativo: dto.ativo ?? true,
      },
    });
    await this.indexacao.enfileirarChunk(chunk.id, empresaId);
    return chunk;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateKnowledgeDto,
  ): Promise<KnowledgeChunk> {
    const existing = await this.findById(user, id);
    await this.prisma.knowledgeChunk.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: dto,
    });
    await this.indexacao.enfileirarChunk(id, existing.empresaId);
    return this.prisma.knowledgeChunk.findUniqueOrThrow({ where: { id } });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    await this.prisma.knowledgeChunk.delete({ where: { id: existing.id } });
  }
}
