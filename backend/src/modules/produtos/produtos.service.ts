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
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type {
  AtivarDto,
  CreateProdutoDto,
  ListProdutosDto,
  UpdateEstoqueDto,
  UpdateProdutoDto,
} from './produtos.dto';

const produtoInclude = {
  _count: { select: { precosEspeciais: true, pedidoItens: true } },
} satisfies Prisma.ProdutoInclude;

type ProdutoWithRel = Prisma.ProdutoGetPayload<{ include: typeof produtoInclude }>;

@Injectable()
export class ProdutosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Empresa do contexto — todos os endpoints filtram por aqui. */
  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }

  async list(user: AuthenticatedUser, params: ListProdutosDto): Promise<Paginated<ProdutoWithRel>> {
    const empresaId = this.requireEmpresa(user);

    const conditions: Prisma.ProdutoWhereInput[] = [{ empresaId }];

    if (params.search) {
      const term = params.search.trim();
      conditions.push({
        OR: [
          { nome: { contains: term, mode: 'insensitive' } },
          { sku: { contains: term, mode: 'insensitive' } },
          { codigoOmie: { contains: term } },
          { marca: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    if (params.linha) conditions.push({ linha: params.linha });
    if (params.categoria) conditions.push({ categoria: params.categoria });
    if (params.marca) conditions.push({ marca: params.marca });
    if (params.ativo !== undefined) conditions.push({ ativo: params.ativo });
    if (params.semEstoque) conditions.push({ estoque: 0 });
    if (params.precoMin !== undefined) conditions.push({ precoTabela: { gte: params.precoMin } });
    if (params.precoMax !== undefined) conditions.push({ precoTabela: { lte: params.precoMax } });

    const where: Prisma.ProdutoWhereInput = { AND: conditions };

    const [total, data] = await Promise.all([
      this.prisma.produto.count({ where }),
      this.prisma.produto.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { [params.sortBy]: params.sortOrder },
        include: produtoInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<ProdutoWithRel> {
    const empresaId = this.requireEmpresa(user);
    const produto = await this.prisma.produto.findFirst({
      where: { id, empresaId },
      include: produtoInclude,
    });
    if (!produto) throw new NotFoundException('Produto', id);
    return produto;
  }

  async create(user: AuthenticatedUser, dto: CreateProdutoDto): Promise<ProdutoWithRel> {
    const empresaId = this.requireEmpresa(user);

    // Custo é opcional — só valida "custo ≤ tabela" quando informado.
    if (dto.precoFabrica != null && dto.precoFabrica > dto.precoTabela) {
      throw new BusinessRuleException('Preço de fábrica não pode ser maior que preço de tabela');
    }
    if (dto.sku) await this.assertSkuUnico(empresaId, dto.sku);
    if (dto.codigoOmie) await this.assertCodigoOmieUnico(empresaId, dto.codigoOmie);

    return this.prisma.produto.create({
      data: { ...dto, empresaId },
      include: produtoInclude,
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateProdutoDto,
  ): Promise<ProdutoWithRel> {
    const existing = await this.findById(user, id);

    const precoTabela = dto.precoTabela ?? Number(existing.precoTabela);
    // Custo é opcional: usa o do dto se veio, senão o existente; valida só quando
    // há custo definido (null = sem custo → nada a comparar).
    const precoFabricaEfetivo =
      dto.precoFabrica !== undefined ? dto.precoFabrica : existing.precoFabrica;
    if (precoFabricaEfetivo != null && Number(precoFabricaEfetivo) > precoTabela) {
      throw new BusinessRuleException('Preço de fábrica não pode ser maior que preço de tabela');
    }
    if (dto.sku && dto.sku !== existing.sku) {
      await this.assertSkuUnico(existing.empresaId, dto.sku);
    }
    if (dto.codigoOmie && dto.codigoOmie !== existing.codigoOmie) {
      await this.assertCodigoOmieUnico(existing.empresaId, dto.codigoOmie);
    }

    await this.prisma.produto.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: dto,
    });
    return this.prisma.produto.findUniqueOrThrow({
      where: { id },
      include: produtoInclude,
    });
  }

  async updateEstoque(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateEstoqueDto,
  ): Promise<ProdutoWithRel> {
    const existing = await this.findById(user, id);
    await this.prisma.produto.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { estoque: dto.estoque, estoqueAtualizadoEm: new Date() },
    });
    return this.prisma.produto.findUniqueOrThrow({
      where: { id },
      include: produtoInclude,
    });
  }

  async setAtivo(user: AuthenticatedUser, id: string, dto: AtivarDto): Promise<ProdutoWithRel> {
    const existing = await this.findById(user, id);
    await this.prisma.produto.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { ativo: dto.ativo },
    });
    return this.prisma.produto.findUniqueOrThrow({
      where: { id },
      include: produtoInclude,
    });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    try {
      await this.prisma.produto.deleteMany({ where: { id, empresaId: existing.empresaId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new BusinessRuleException(
          'Produto possui pedidos vinculados. Desative o produto em vez de excluir.',
        );
      }
      throw err;
    }
  }

  /** Lista os valores únicos de linha/categoria/marca pra usar em filtros. */
  async facets(
    user: AuthenticatedUser,
  ): Promise<{ linhas: string[]; categorias: string[]; marcas: string[] }> {
    const empresaId = this.requireEmpresa(user);
    const rows = await this.prisma.produto.findMany({
      where: { empresaId, ativo: true },
      select: { linha: true, categoria: true, marca: true },
    });
    return {
      linhas: this.uniq(rows.map((r) => r.linha)),
      categorias: this.uniq(rows.map((r) => r.categoria)),
      marcas: this.uniq(rows.map((r) => r.marca)),
    };
  }

  private uniq(list: (string | null)[]): string[] {
    return [...new Set(list.filter((v): v is string => Boolean(v && v.trim())))].sort();
  }

  private async assertSkuUnico(empresaId: string, sku: string): Promise<void> {
    const existe = await this.prisma.produto.findUnique({
      where: { empresaId_sku: { empresaId, sku } },
      select: { id: true },
    });
    if (existe) {
      throw new BusinessRuleException(
        `Já existe produto com SKU ${sku} nesta empresa`,
        ErrorCode.ALREADY_EXISTS,
      );
    }
  }

  private async assertCodigoOmieUnico(empresaId: string, codigoOmie: string): Promise<void> {
    const existe = await this.prisma.produto.findUnique({
      where: { empresaId_codigoOmie: { empresaId, codigoOmie } },
      select: { id: true },
    });
    if (existe) {
      throw new BusinessRuleException(
        `Já existe produto com código OMIE ${codigoOmie} nesta empresa`,
        ErrorCode.ALREADY_EXISTS,
      );
    }
  }
}
