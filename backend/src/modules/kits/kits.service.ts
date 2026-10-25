import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/** Um kit pronto pra gravar (montado pelo plano de importação). */
export interface KitPlanejado {
  produto: string;
  modelo: string;
  combinacao: string;
  pecas: number;
  aleatorio: boolean;
  modelosBase: string[];
  origem: string;
  itens: Array<{
    tamanho: string;
    sku: string;
    skuSecundario: string | null;
    situacaoMagis: string | null;
    componentes: Array<{ variacaoId: string; quantidade: number }> | null;
  }>;
}

/**
 * Kits dos marketplaces no ERP (25/10, card cmvnyodx7). Tabelas próprias:
 * nunca aparecem na vitrine. Sem EAN. A composição aponta pras variações do
 * catálogo que o kit consome.
 */
@Injectable()
export class KitsService {
  constructor(private readonly prisma: PrismaService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin vê os kits');
    }
    return user.empresaIdAtiva;
  }

  async listar(
    user: AuthenticatedUser,
    q: { busca?: string; produto?: string; semComposicao?: boolean; page?: number },
  ) {
    const empresaId = this.empresa(user);
    const busca = q.busca?.trim().slice(0, 80);
    const c = busca ? { contains: busca, mode: 'insensitive' as const } : null;
    const where: Prisma.CatalogoKitWhereInput = {
      empresaId,
      ativo: true,
      ...(q.produto ? { produto: q.produto } : {}),
      ...(q.semComposicao ? { itens: { some: { composicaoOk: false } } } : {}),
      ...(c
        ? {
            OR: [
              { produto: c },
              { modelo: c },
              { combinacao: c },
              { itens: { some: { OR: [{ sku: c }, { skuSecundario: c }] } } },
            ],
          }
        : {}),
    };
    const limit = 40;
    const page = Math.max(q.page ?? 1, 1);
    const [total, kits, produtos, contas] = await Promise.all([
      this.prisma.catalogoKit.count({ where }),
      this.prisma.catalogoKit.findMany({
        where,
        orderBy: [{ produto: 'asc' }, { modelo: 'asc' }, { pecas: 'asc' }, { combinacao: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          itens: {
            where: { ativo: true },
            orderBy: { criadoEm: 'asc' },
            select: {
              id: true,
              tamanho: true,
              sku: true,
              skuSecundario: true,
              situacaoMagis: true,
              composicaoOk: true,
            },
          },
        },
      }),
      this.prisma.catalogoKit.groupBy({
        by: ['produto'],
        where: { empresaId, ativo: true },
        _count: { _all: true },
        orderBy: { produto: 'asc' },
      }),
      this.prisma.catalogoKitItem.groupBy({
        by: ['composicaoOk'],
        where: { empresaId, ativo: true },
        _count: { _all: true },
      }),
    ]);
    return {
      data: kits,
      total,
      page,
      limit,
      produtos: produtos.map((p) => ({ produto: p.produto, kits: p._count._all })),
      resumo: {
        skus: contas.reduce((s, x) => s + x._count._all, 0),
        semComposicao: contas.find((x) => !x.composicaoOk)?._count._all ?? 0,
      },
    };
  }

  /** Composição de um tamanho do kit, com o rótulo da peça. */
  async item(user: AuthenticatedUser, itemId: string) {
    const empresaId = this.empresa(user);
    const it = await this.prisma.catalogoKitItem.findFirst({
      where: { id: itemId, empresaId },
      include: {
        kit: true,
        componentes: {
          include: {
            variacao: {
              select: {
                sku: true,
                modelo: { select: { nome: true } },
                modeloCor: { select: { cor: { select: { nome: true } } } },
                modeloTamanho: { select: { tamanho: { select: { nome: true } } } },
              },
            },
          },
        },
      },
    });
    if (!it) throw new NotFoundException('Kit não encontrado');
    return {
      ...it,
      componentes: it.componentes.map((c) => ({
        quantidade: c.quantidade,
        sku: c.variacao.sku,
        rotulo: [
          c.variacao.modelo.nome,
          c.variacao.modeloCor.cor.nome,
          c.variacao.modeloTamanho.tamanho.nome,
        ].join(' · '),
      })),
    };
  }

  /**
   * Grava o plano de importação (idempotente: kit por produto+modelo+combinação,
   * tamanho por SKU). Não apaga nada que já exista; componentes do item são
   * regravados a cada importação.
   */
  async importar(
    empresaId: string,
    kits: KitPlanejado[],
  ): Promise<{ kits: number; itens: number; componentes: number }> {
    let nItens = 0;
    let nComp = 0;
    for (const k of kits) {
      const kit = await this.prisma.catalogoKit.upsert({
        where: {
          empresaId_produto_modelo_combinacao: {
            empresaId,
            produto: k.produto,
            modelo: k.modelo,
            combinacao: k.combinacao,
          },
        },
        create: {
          empresaId,
          produto: k.produto,
          modelo: k.modelo,
          combinacao: k.combinacao,
          pecas: k.pecas,
          aleatorio: k.aleatorio,
          modelosBase: k.modelosBase,
          origem: k.origem,
        },
        update: { pecas: k.pecas, aleatorio: k.aleatorio, modelosBase: k.modelosBase },
      });
      for (const it of k.itens) {
        const ok = !!it.componentes && it.componentes.length > 0;
        const item = await this.prisma.catalogoKitItem.upsert({
          where: { empresaId_sku: { empresaId, sku: it.sku } },
          create: {
            empresaId,
            kitId: kit.id,
            tamanho: it.tamanho,
            sku: it.sku,
            skuSecundario: it.skuSecundario,
            situacaoMagis: it.situacaoMagis,
            composicaoOk: ok,
          },
          update: {
            kitId: kit.id,
            tamanho: it.tamanho,
            skuSecundario: it.skuSecundario,
            situacaoMagis: it.situacaoMagis,
            composicaoOk: ok,
          },
        });
        nItens++;
        await this.prisma.catalogoKitComponente.deleteMany({ where: { kitItemId: item.id } });
        if (ok) {
          await this.prisma.catalogoKitComponente.createMany({
            data: it.componentes!.map((c) => ({
              kitItemId: item.id,
              variacaoId: c.variacaoId,
              quantidade: c.quantidade,
            })),
          });
          nComp += it.componentes!.length;
        }
      }
    }
    return { kits: kits.length, itens: nItens, componentes: nComp };
  }
}
