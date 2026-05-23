import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { buildPaginated, type Paginated } from '@shared/types/pagination';
import type { CreateEmpresaDto, ListEmpresasDto, UpdateEmpresaDto } from './empresas.dto';

@Injectable()
export class EmpresasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista as empresas que o usuário autenticado pode ACESSAR.
   *
   * - ADMIN: cross-tenant — retorna TODAS as empresas ativas do sistema.
   *   (Master da plataforma, pode operar como suporte em qualquer tenant.)
   * - Demais papéis: apenas as empresas vinculadas via UsuarioEmpresa.
   *
   * Usado pelo `EmpresaSwitcher` na sidebar do frontend pra trocar de
   * tenant ativo via header `X-Empresa-Id`.
   */
  async listMine(
    user: AuthenticatedUser,
  ): Promise<Array<{ id: string; nome: string; logoUrl: string | null }>> {
    if (user.role === 'ADMIN') {
      // ADMIN cross-tenant: vê TODAS as empresas ativas
      return this.prisma.empresa.findMany({
        where: { ativo: true },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true, logoUrl: true },
      });
    }
    // Demais: apenas as vinculadas via UsuarioEmpresa
    const vinculos = await this.prisma.usuarioEmpresa.findMany({
      where: { usuarioId: user.id, empresa: { ativo: true } },
      orderBy: { empresa: { nome: 'asc' } },
      select: {
        empresa: { select: { id: true, nome: true, logoUrl: true } },
      },
    });
    return vinculos.map((v) => v.empresa);
  }

  async list(
    params: ListEmpresasDto,
  ): Promise<Paginated<Awaited<ReturnType<typeof this.findById>>>> {
    const where = {
      ...(params.search
        ? {
            OR: [
              { nome: { contains: params.search, mode: 'insensitive' as const } },
              { cnpj: { contains: params.search } },
            ],
          }
        : {}),
      ...(params.ativo !== undefined ? { ativo: params.ativo } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.empresa.count({ where }),
      this.prisma.empresa.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { criadoEm: 'desc' },
        include: { _count: { select: { usuarios: true, clientes: true } } },
      }),
    ]);

    return buildPaginated(items, total, params.page, params.limit);
  }

  async findById(id: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
      include: { _count: { select: { usuarios: true, clientes: true } } },
    });
    if (!empresa) throw new NotFoundException('Empresa', id);
    return empresa;
  }

  async create(dto: CreateEmpresaDto) {
    return this.prisma.empresa.create({
      data: { ...dto, ativo: true },
    });
  }

  async update(id: string, dto: UpdateEmpresaDto) {
    await this.findById(id); // garante existência
    return this.prisma.empresa.update({ where: { id }, data: dto });
  }

  async deactivate(id: string) {
    await this.findById(id);
    return this.prisma.empresa.update({ where: { id }, data: { ativo: false } });
  }

  async activate(id: string) {
    await this.findById(id);
    return this.prisma.empresa.update({ where: { id }, data: { ativo: true } });
  }
}
