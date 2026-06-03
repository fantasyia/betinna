import { Injectable } from '@nestjs/common';
import type { VariavelCustomizada } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * VariavelCustomizadaService (Fase C — spec §2.3) — o admin define as variáveis
 * {{custom.<chave>}} da empresa (com valor padrão). O FluxoExecutor as injeta no
 * contexto como base do {{custom.*}}, sobrescritas pelo Lead.variaveis.
 */
@Injectable()
export class VariavelCustomizadaService {
  constructor(private readonly prisma: PrismaService) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = getCallerEmpresaId(user);
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  async list(user: AuthenticatedUser): Promise<VariavelCustomizada[]> {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.variavelCustomizada.findMany({
      where: { empresaId },
      orderBy: { chave: 'asc' },
    });
  }

  /** Cria ou atualiza por (empresa, chave). */
  async upsert(
    user: AuthenticatedUser,
    dto: { chave: string; descricao?: string; valorPadrao?: string },
  ): Promise<VariavelCustomizada> {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.variavelCustomizada.upsert({
      where: { empresaId_chave: { empresaId, chave: dto.chave } },
      create: {
        empresaId,
        chave: dto.chave,
        descricao: dto.descricao ?? null,
        valorPadrao: dto.valorPadrao ?? null,
      },
      update: { descricao: dto.descricao ?? null, valorPadrao: dto.valorPadrao ?? null },
    });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const empresaId = this.requireEmpresa(user);
    const r = await this.prisma.variavelCustomizada.deleteMany({ where: { id, empresaId } });
    if (r.count === 0) throw new NotFoundException('Variável', id);
  }
}
