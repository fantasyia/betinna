import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { custoDosItens, lucroDoPedido, type ItemPedido } from './financeiro';

@Injectable()
export class PedidosMarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  private empresa(user: AuthenticatedUser): string {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin vê os pedidos dos marketplaces');
    }
    return user.empresaIdAtiva;
  }

  private comLucro<
    T extends {
      valor: number;
      liquido: number | null;
      custo: number | null;
      custoCompleto: boolean | null;
    },
  >(p: T) {
    return { ...p, ...lucroDoPedido(p) };
  }

  async listar(
    user: AuthenticatedUser,
    q: {
      plataforma?: string;
      situacao?: string;
      de?: string;
      ate?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const empresaId = this.empresa(user);
    const where: Prisma.MarketplaceOrderWhereInput = {
      empresaId,
      ...(q.plataforma
        ? { plataforma: q.plataforma as Prisma.EnumMarketplacePlatformFilter['equals'] }
        : {}),
      ...(q.de || q.ate
        ? {
            pedidoEm: {
              ...(q.de ? { gte: new Date(q.de) } : {}),
              ...(q.ate ? { lte: new Date(q.ate) } : {}),
            },
          }
        : {}),
    };
    // Devolução ABERTA nos Incidentes vence o status do canal: o pedido está
    // "em devolução" mesmo que o marketplace ainda diga "entregue".
    const devolucoes = await this.prisma.marketplaceIncident.findMany({
      where: {
        empresaId,
        tipo: 'DEVOLUCAO',
        status: { notIn: ['RESOLVIDO', 'CANCELADO', 'EXPIRADO'] },
        pedidoExternoId: { not: null },
      },
      select: { pedidoExternoId: true },
    });
    const emDevolucao = devolucoes.map((d) => d.pedidoExternoId as string);
    const porSituacao = await this.prisma.marketplaceOrder.groupBy({
      by: ['situacao'],
      where: { ...where, numeroExterno: { notIn: emDevolucao } },
      _count: { _all: true },
    });
    const nDevolucao = await this.prisma.marketplaceOrder.count({
      where: {
        ...where,
        OR: [{ situacao: 'EM_DEVOLUCAO' }, { numeroExterno: { in: emDevolucao } }],
      },
    });
    const contagem: Record<string, number> = {};
    for (const g of porSituacao) {
      if (g.situacao && g.situacao !== 'EM_DEVOLUCAO') contagem[g.situacao] = g._count._all;
    }
    contagem.EM_DEVOLUCAO = nDevolucao;
    if (q.situacao === 'EM_DEVOLUCAO') {
      where.OR = [{ situacao: 'EM_DEVOLUCAO' }, { numeroExterno: { in: emDevolucao } }];
    } else if (q.situacao) {
      where.situacao = q.situacao;
      where.numeroExterno = { notIn: emDevolucao };
    }
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const page = Math.max(q.page ?? 1, 1);
    const [total, rows, soma] = await Promise.all([
      this.prisma.marketplaceOrder.count({ where }),
      this.prisma.marketplaceOrder.findMany({
        where,
        orderBy: { pedidoEm: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.marketplaceOrder.aggregate({
        where: { ...where, NOT: { situacao: 'CANCELADO' } },
        _sum: { valor: true, taxas: true, frete: true, liquido: true, custo: true },
        _count: { _all: true },
      }),
    ]);
    return {
      data: rows.map((p) => ({
        ...this.comLucro(p),
        situacao: emDevolucao.includes(p.numeroExterno) ? 'EM_DEVOLUCAO' : p.situacao,
      })),
      porSituacao: contagem,
      total,
      page,
      limit,
      resumo: {
        pedidos: soma._count._all,
        bruto: soma._sum.valor ?? 0,
        taxas: soma._sum.taxas ?? 0,
        frete: soma._sum.frete ?? 0,
        liquido: soma._sum.liquido ?? 0,
        custo: soma._sum.custo ?? 0,
      },
    };
  }

  async detalhe(user: AuthenticatedUser, id: string) {
    const empresaId = this.empresa(user);
    const p = await this.prisma.marketplaceOrder.findFirst({ where: { id, empresaId } });
    if (!p) throw new NotFoundException('Pedido do marketplace não encontrado');
    return this.comLucro(p);
  }

  /** SKUs vendidos que ficaram SEM custo (kit, SKU diferente do cadastro). */
  async skusSemCusto(user: AuthenticatedUser) {
    const empresaId = this.empresa(user);
    const rows = await this.prisma.marketplaceOrder.findMany({
      where: { empresaId, custoCompleto: false },
      select: { plataforma: true, itens: true },
      take: 2000,
      orderBy: { pedidoEm: 'desc' },
    });
    const mapa = new Map<
      string,
      {
        plataforma: string;
        sku: string | null;
        titulo: string;
        variacao: string | null;
        pedidos: number;
      }
    >();
    for (const r of rows) {
      for (const it of (r.itens ?? []) as unknown as ItemPedido[]) {
        if (it.custoUnit !== null && it.custoUnit !== undefined) continue;
        const k = `${r.plataforma}|${it.sku ?? it.titulo}`;
        const atual = mapa.get(k);
        if (atual) atual.pedidos++;
        else
          mapa.set(k, {
            plataforma: r.plataforma,
            sku: it.sku,
            titulo: it.titulo,
            variacao: it.variacao,
            pedidos: 1,
          });
      }
    }
    return [...mapa.values()].sort((a, b) => b.pedidos - a.pedidos);
  }

  /** Liga um SKU do marketplace a uma variação do cadastro (kit = quantidade > 1) e recalcula. */
  async vincular(
    user: AuthenticatedUser,
    dto: { plataforma: string; sku: string; variacaoId: string; quantidade: number },
  ) {
    const empresaId = this.empresa(user);
    const v = await this.prisma.catalogoVariacao.findFirst({
      where: { id: dto.variacaoId, modelo: { empresaId } },
      select: { id: true },
    });
    if (!v) throw new NotFoundException('Variação não encontrada nesta empresa');
    await this.prisma.skuMarketplaceVinculo.upsert({
      where: { empresaId_plataforma_sku: { empresaId, plataforma: dto.plataforma, sku: dto.sku } },
      create: {
        empresaId,
        plataforma: dto.plataforma,
        sku: dto.sku,
        variacaoId: dto.variacaoId,
        quantidade: dto.quantidade,
      },
      update: { variacaoId: dto.variacaoId, quantidade: dto.quantidade },
    });
    return this.recalcularCustos(empresaId);
  }

  /** Recalcula o custo dos pedidos que ainda não têm custo completo. */
  async recalcularCustos(empresaId: string): Promise<{ recalculados: number }> {
    const rows = await this.prisma.marketplaceOrder.findMany({
      where: {
        empresaId,
        OR: [{ custoCompleto: false }, { custoCompleto: null, itens: { not: Prisma.JsonNull } }],
      },
      select: { id: true, plataforma: true, itens: true },
      take: 2000,
    });
    for (const r of rows) {
      const itens = (r.itens ?? []) as unknown as ItemPedido[];
      if (!itens.length) continue;
      const c = await custoDosItens(this.prisma, empresaId, r.plataforma, itens);
      await this.prisma.marketplaceOrder.update({
        where: { id: r.id },
        data: {
          itens: c.itens as unknown as Prisma.InputJsonValue,
          custo: c.custo,
          custoCompleto: c.completo,
        },
      });
    }
    return { recalculados: rows.length };
  }

  /** Variações do cadastro pra escolher no vínculo (nome do modelo · cor · tamanho · SKU). */
  async variacoes(user: AuthenticatedUser, busca?: string) {
    const empresaId = this.empresa(user);
    const rows = await this.prisma.catalogoVariacao.findMany({
      where: {
        modelo: { empresaId },
        ativo: true,
        ...(busca?.trim()
          ? {
              OR: [
                { sku: { contains: busca.trim(), mode: 'insensitive' } },
                { modelo: { nome: { contains: busca.trim(), mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        sku: true,
        modelo: { select: { nome: true } },
        modeloCor: { select: { cor: { select: { nome: true } } } },
        modeloTamanho: { select: { tamanho: { select: { nome: true } } } },
        modeloLinha: { select: { custoPorPeca: true, linha: { select: { nome: true } } } },
      },
      take: 50,
    });
    return rows.map((v) => ({
      id: v.id,
      rotulo: [
        v.modelo.nome,
        v.modeloCor?.cor.nome,
        v.modeloLinha?.linha.nome,
        v.modeloTamanho?.tamanho.nome,
      ]
        .filter(Boolean)
        .join(' · '),
      sku: v.sku,
      custoPorPeca:
        v.modeloLinha?.custoPorPeca === null || v.modeloLinha?.custoPorPeca === undefined
          ? null
          : Number(v.modeloLinha.custoPorPeca),
    }));
  }
}
