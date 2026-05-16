import { Injectable } from '@nestjs/common';
import type { ClientePrecoEspecial } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ClientesService } from '@modules/clientes/clientes.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  BulkUpsertPrecoEspecialDto,
  UpsertPrecoEspecialDto,
} from './precos-especiais.dto';

const precoInclude = {
  produto: {
    select: {
      id: true,
      nome: true,
      sku: true,
      marca: true,
      linha: true,
      unidade: true,
      precoTabela: true,
    },
  },
};

@Injectable()
export class PrecosEspeciaisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientes: ClientesService,
  ) {}

  /**
   * Lista preços negociados de um cliente.
   * Valida acesso ao cliente via ClientesService (tenant + rep filtering).
   */
  async list(user: AuthenticatedUser, clienteId: string): Promise<ClientePrecoEspecial[]> {
    await this.clientes.findById(user, clienteId);
    return this.prisma.clientePrecoEspecial.findMany({
      where: { clienteId },
      include: precoInclude,
      orderBy: { produto: { nome: 'asc' } },
    });
  }

  async upsert(
    user: AuthenticatedUser,
    clienteId: string,
    dto: UpsertPrecoEspecialDto,
  ): Promise<ClientePrecoEspecial> {
    const cliente = await this.clientes.findById(user, clienteId);
    await this.assertProdutoDaMesmaEmpresa(cliente.empresaId, dto.produtoId);

    return this.prisma.clientePrecoEspecial.upsert({
      where: {
        clienteId_produtoId: { clienteId, produtoId: dto.produtoId },
      },
      update: {
        precoEspecial: dto.precoEspecial,
        descontoBase: dto.descontoBase,
        validoAte: dto.validoAte,
      },
      create: {
        clienteId,
        produtoId: dto.produtoId,
        precoEspecial: dto.precoEspecial,
        descontoBase: dto.descontoBase,
        validoAte: dto.validoAte,
      },
      include: precoInclude,
    });
  }

  async bulkUpsert(
    user: AuthenticatedUser,
    clienteId: string,
    dto: BulkUpsertPrecoEspecialDto,
  ): Promise<{ ok: true; processados: number }> {
    const cliente = await this.clientes.findById(user, clienteId);
    const produtoIds = [...new Set(dto.itens.map((i) => i.produtoId))];
    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: produtoIds }, empresaId: cliente.empresaId },
      select: { id: true },
    });
    if (produtos.length !== produtoIds.length) {
      throw new BusinessRuleException(
        'Um ou mais produtos não pertencem à empresa do cliente',
      );
    }
    await this.prisma.$transaction(
      dto.itens.map((item) =>
        this.prisma.clientePrecoEspecial.upsert({
          where: {
            clienteId_produtoId: { clienteId, produtoId: item.produtoId },
          },
          update: {
            precoEspecial: item.precoEspecial,
            descontoBase: item.descontoBase,
            validoAte: item.validoAte,
          },
          create: {
            clienteId,
            produtoId: item.produtoId,
            precoEspecial: item.precoEspecial,
            descontoBase: item.descontoBase,
            validoAte: item.validoAte,
          },
        }),
      ),
    );
    return { ok: true, processados: dto.itens.length };
  }

  async remove(user: AuthenticatedUser, clienteId: string, produtoId: string): Promise<void> {
    await this.clientes.findById(user, clienteId);
    const existing = await this.prisma.clientePrecoEspecial.findUnique({
      where: { clienteId_produtoId: { clienteId, produtoId } },
    });
    if (!existing) throw new NotFoundException('Preço especial');
    await this.prisma.clientePrecoEspecial.delete({
      where: { clienteId_produtoId: { clienteId, produtoId } },
    });
  }

  private async assertProdutoDaMesmaEmpresa(
    empresaId: string,
    produtoId: string,
  ): Promise<void> {
    const produto = await this.prisma.produto.findFirst({
      where: { id: produtoId, empresaId },
      select: { id: true },
    });
    if (!produto) {
      throw new BusinessRuleException(
        'Produto não pertence à empresa deste cliente',
      );
    }
  }
}
