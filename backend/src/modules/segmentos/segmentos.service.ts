import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { ConditionDto, RegrasDto, UpsertSegmentoDto } from './segmentos.dto';

@Injectable()
export class SegmentosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.segmento.findMany({
      where: { empresaId },
      orderBy: { atualizadoEm: 'desc' },
    });
  }

  async getById(user: AuthenticatedUser, id: string) {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.segmento.findFirst({ where: { id, empresaId } });
    if (!row) throw new NotFoundException('Segmento não encontrado');
    return row;
  }

  async upsert(user: AuthenticatedUser, id: string | null, dto: UpsertSegmentoDto) {
    const empresaId = this.requireEmpresa(user);

    const conflict = await this.prisma.segmento.findFirst({
      where: { empresaId, nome: dto.nome, ...(id ? { NOT: { id } } : {}) },
      select: { id: true },
    });
    if (conflict) {
      throw new BusinessRuleException(`Segmento "${dto.nome}" já existe.`);
    }

    const data = {
      empresaId,
      nome: dto.nome,
      descricao: dto.descricao ?? null,
      regrasJson: dto.regras as unknown as Prisma.InputJsonValue,
      cor: dto.cor ?? '#facc15',
      ativo: dto.ativo,
    };

    if (id) return this.prisma.segmento.update({ where: { id }, data });
    return this.prisma.segmento.create({ data });
  }

  async delete(user: AuthenticatedUser, id: string) {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.segmento.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Segmento não encontrado');
    await this.prisma.segmento.delete({ where: { id } });
    return { deleted: true };
  }

  /** Lista clientes que batem com as regras de um segmento já salvo. */
  async listarClientes(user: AuthenticatedUser, id: string, limit = 50) {
    const empresaId = this.requireEmpresa(user);
    const seg = await this.prisma.segmento.findFirst({ where: { id, empresaId } });
    if (!seg) throw new NotFoundException('Segmento não encontrado');
    const regras = seg.regrasJson as unknown as RegrasDto;
    return this.executar(empresaId, regras, limit);
  }

  /** Preview ao vivo enquanto edita regras (não salva). */
  async preview(user: AuthenticatedUser, regras: RegrasDto, limit = 20) {
    const empresaId = this.requireEmpresa(user);
    return this.executar(empresaId, regras, limit);
  }

  private async executar(empresaId: string, regras: RegrasDto, limit: number) {
    const conditions = regras.conditions.map(toPrismaCondition).filter(Boolean) as Prisma.ClienteWhereInput[];
    const where: Prisma.ClienteWhereInput = {
      empresaId,
      ...(regras.logic === 'OR'
        ? { OR: conditions }
        : { AND: conditions }),
    };

    const [clientes, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        take: limit,
        orderBy: { atualizadoEm: 'desc' },
        select: {
          id: true,
          nome: true,
          cnpj: true,
          email: true,
          cidade: true,
          uf: true,
          segmento: true,
          status: true,
          score: true,
          representante: { select: { id: true, nome: true } },
        },
      }),
      this.prisma.cliente.count({ where }),
    ]);
    return { clientes, total };
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }
}

// ─── Helpers ───────────────────────────────────────────────

function toPrismaCondition(c: ConditionDto): Prisma.ClienteWhereInput | null {
  const { campo, op, valor } = c;
  const key = campo as keyof Prisma.ClienteWhereInput;

  switch (op) {
    case 'eq':
      return { [key]: valor } as unknown as Prisma.ClienteWhereInput;
    case 'neq':
      return { NOT: { [key]: valor } } as unknown as Prisma.ClienteWhereInput;
    case 'gt':
      return { [key]: { gt: valor } } as unknown as Prisma.ClienteWhereInput;
    case 'gte':
      return { [key]: { gte: valor } } as unknown as Prisma.ClienteWhereInput;
    case 'lt':
      return { [key]: { lt: valor } } as unknown as Prisma.ClienteWhereInput;
    case 'lte':
      return { [key]: { lte: valor } } as unknown as Prisma.ClienteWhereInput;
    case 'in':
      if (!Array.isArray(valor)) return null;
      return { [key]: { in: valor } } as unknown as Prisma.ClienteWhereInput;
    case 'contains':
      if (typeof valor !== 'string') return null;
      return { [key]: { contains: valor, mode: 'insensitive' } } as unknown as Prisma.ClienteWhereInput;
    default:
      return null;
  }
}
