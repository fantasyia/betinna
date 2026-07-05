import { HttpStatus, Injectable } from '@nestjs/common';
import type { CampanhaTemplate } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { AppException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { CreateCampanhaTemplateDto, UpdateCampanhaTemplateDto } from './campanha-template.dto';

/**
 * Biblioteca de templates de campanha (escopo EMPRESA). CRUD simples e
 * tenant-scoped: cada empresa vê/gerencia só os seus.
 */
@Injectable()
export class CampanhaTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Usuário sem empresa ativa',
        HttpStatus.BAD_REQUEST,
      );
    }
    return user.empresaIdAtiva;
  }

  async list(user: AuthenticatedUser): Promise<CampanhaTemplate[]> {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.campanhaTemplate.findMany({
      where: { empresaId },
      orderBy: { atualizadoEm: 'desc' },
    });
  }

  async create(user: AuthenticatedUser, dto: CreateCampanhaTemplateDto): Promise<CampanhaTemplate> {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.campanhaTemplate.create({
      data: {
        empresaId,
        criadoPorId: user.id,
        nome: dto.nome,
        descricao: dto.descricao ?? null,
        canal: dto.canal,
        assunto: dto.assunto ?? null,
        mensagemWa: dto.mensagemWa ?? null,
        mensagemEmail: dto.mensagemEmail ?? null,
        objetivo: dto.objetivo ?? null,
      },
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateCampanhaTemplateDto,
  ): Promise<CampanhaTemplate> {
    const empresaId = this.requireEmpresa(user);
    // updateMany com filtro de empresa = defesa multi-tenant (não edita de outra empresa).
    const r = await this.prisma.campanhaTemplate.updateMany({
      where: { id, empresaId },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.descricao !== undefined ? { descricao: dto.descricao || null } : {}),
        ...(dto.canal !== undefined ? { canal: dto.canal } : {}),
        ...(dto.assunto !== undefined ? { assunto: dto.assunto || null } : {}),
        ...(dto.mensagemWa !== undefined ? { mensagemWa: dto.mensagemWa || null } : {}),
        ...(dto.mensagemEmail !== undefined ? { mensagemEmail: dto.mensagemEmail || null } : {}),
        ...(dto.objetivo !== undefined ? { objetivo: dto.objetivo || null } : {}),
      },
    });
    if (r.count === 0) throw new NotFoundException('CampanhaTemplate', id);
    return this.prisma.campanhaTemplate.findUniqueOrThrow({ where: { id } });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<{ ok: true }> {
    const empresaId = this.requireEmpresa(user);
    const r = await this.prisma.campanhaTemplate.deleteMany({ where: { id, empresaId } });
    if (r.count === 0) throw new NotFoundException('CampanhaTemplate', id);
    return { ok: true };
  }
}
