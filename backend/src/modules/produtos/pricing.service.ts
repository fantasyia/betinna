import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';

/**
 * Resultado da resolução de preço para um cliente+produto.
 */
export interface ResolvedPrice {
  produtoId: string;
  precoBase: number; // preço de tabela do produto
  precoFinal: number; // preço efetivo após preço negociado e descontos
  descontoBase: number; // % de desconto base negociado para o cliente
  negociado: boolean; // true se há ClientePrecoEspecial
  vigente: boolean; // false se a tabela negociada está expirada
}

/**
 * Resolve preços considerando a tabela negociada por cliente.
 *
 * Auditoria 2026-05-15 P0:
 * - Todos os métodos agora exigem `empresaId` obrigatório.
 * - Queries em `produto` filtram por `empresaId` (impede REP de injetar
 *   produtoId de outra empresa em pedido/proposta).
 * - Queries em `clientePrecoEspecial` validam que o cliente pertence
 *   à empresa via includes/checks transitivos.
 *
 * Regras:
 *  - Se houver ClientePrecoEspecial vigente, usa esse preço como base.
 *  - Caso contrário, usa precoTabela do Produto.
 *  - descontoBase é aplicado sempre que negociado.
 *  - validoAte no passado → preço negociado ignorado, volta pra tabela.
 *
 * Centraliza a regra pra ser usada por:
 *  - Catálogo do Rep (preview de preço pro cliente)
 *  - Novo Pedido (preço quando rep adiciona item)
 *  - Proposta gerada
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Preço único para um produto sem cliente (preço de tabela).
   * Filtra por empresaId — produto de outro tenant retorna null.
   */
  async priceFor(empresaId: string, produtoId: string): Promise<ResolvedPrice | null> {
    if (!empresaId) throw new Error('empresaId obrigatório em PricingService.priceFor');
    const produto = await this.prisma.produto.findFirst({
      where: { id: produtoId, empresaId },
      select: { id: true, precoTabela: true },
    });
    if (!produto) return null;
    return {
      produtoId: produto.id,
      precoBase: Number(produto.precoTabela),
      precoFinal: Number(produto.precoTabela),
      descontoBase: 0,
      negociado: false,
      vigente: true,
    };
  }

  /**
   * Preço para um cliente específico (aplica tabela negociada se houver).
   * Cliente e produto DEVEM pertencer à mesma empresa — caso contrário retorna null.
   */
  async priceForClient(
    empresaId: string,
    clienteId: string,
    produtoId: string,
    now: Date = new Date(),
  ): Promise<ResolvedPrice | null> {
    if (!empresaId) throw new Error('empresaId obrigatório em PricingService.priceForClient');
    // AUDITORIA: produto deve ser da empresa (impede cross-tenant)
    const produto = await this.prisma.produto.findFirst({
      where: { id: produtoId, empresaId },
      select: { id: true, precoTabela: true },
    });
    if (!produto) return null;

    // ClientePrecoEspecial só tem sentido se cliente também é da empresa.
    // Validamos via include (cliente.empresaId).
    const especial = await this.prisma.clientePrecoEspecial.findFirst({
      where: {
        clienteId,
        produtoId,
        cliente: { empresaId },
      },
      select: { precoEspecial: true, descontoBase: true, validoAte: true },
    });

    if (especial) {
      const vigente = !especial.validoAte || especial.validoAte >= now;
      if (vigente) {
        return {
          produtoId: produto.id,
          precoBase: Number(produto.precoTabela),
          precoFinal: this.applyDiscount(Number(especial.precoEspecial), especial.descontoBase),
          descontoBase: especial.descontoBase,
          negociado: true,
          vigente: true,
        };
      }
      // Caiu fora da validade — devolve preço de tabela e marca não-vigente
      return {
        produtoId: produto.id,
        precoBase: Number(produto.precoTabela),
        precoFinal: Number(produto.precoTabela),
        descontoBase: 0,
        negociado: true,
        vigente: false,
      };
    }

    return {
      produtoId: produto.id,
      precoBase: Number(produto.precoTabela),
      precoFinal: Number(produto.precoTabela),
      descontoBase: 0,
      negociado: false,
      vigente: true,
    };
  }

  /**
   * Versão em lote — útil pro Catálogo do Rep mostrar preço de N produtos
   * ao mesmo tempo sem N queries.
   *
   * AUDITORIA: filtra produtos por empresaId — produtos cross-tenant
   * são silenciosamente removidos do resultado (não estarão no Map).
   */
  async priceForClientBatch(
    empresaId: string,
    clienteId: string,
    produtoIds: string[],
    now: Date = new Date(),
  ): Promise<Map<string, ResolvedPrice>> {
    if (!empresaId) throw new Error('empresaId obrigatório em PricingService.priceForClientBatch');
    if (produtoIds.length === 0) return new Map();

    const [produtos, especiais] = await Promise.all([
      this.prisma.produto.findMany({
        where: { id: { in: produtoIds }, empresaId },
        select: { id: true, precoTabela: true },
      }),
      this.prisma.clientePrecoEspecial.findMany({
        where: {
          clienteId,
          produtoId: { in: produtoIds },
          cliente: { empresaId },
        },
        select: {
          produtoId: true,
          precoEspecial: true,
          descontoBase: true,
          validoAte: true,
        },
      }),
    ]);

    const especialMap = new Map(especiais.map((e) => [e.produtoId, e]));
    const result = new Map<string, ResolvedPrice>();

    for (const p of produtos) {
      const e = especialMap.get(p.id);
      if (e) {
        const vigente = !e.validoAte || e.validoAte >= now;
        result.set(p.id, {
          produtoId: p.id,
          precoBase: Number(p.precoTabela),
          precoFinal: vigente
            ? this.applyDiscount(Number(e.precoEspecial), e.descontoBase)
            : Number(p.precoTabela),
          descontoBase: vigente ? e.descontoBase : 0,
          negociado: true,
          vigente,
        });
      } else {
        result.set(p.id, {
          produtoId: p.id,
          precoBase: Number(p.precoTabela),
          precoFinal: Number(p.precoTabela),
          descontoBase: 0,
          negociado: false,
          vigente: true,
        });
      }
    }
    return result;
  }

  /** Aplica desconto % a um valor, com 2 casas decimais. */
  private applyDiscount(price: number, discountPct: number): number {
    if (discountPct <= 0) return price;
    const result = price * (1 - discountPct / 100);
    return Math.round(result * 100) / 100;
  }
}
