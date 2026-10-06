import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EstoqueService } from './estoque.service';
import type { CompraInsumoDto, InsumoDto, MovimentoInsumoDto } from './insumos.dto';

const D = (v: number, casas: number) => new Prisma.Decimal(v.toFixed(casas));
const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

/**
 * Custo médio PONDERADO depois de uma compra. Saldo negativo (gastou antes de
 * lançar a compra) não puxa a média pra baixo: conta como zero.
 */
export function novoCustoMedio(
  saldoAntes: number,
  custoAntes: number,
  qtdCompra: number,
  custoCompra: number,
): number {
  const base = Math.max(0, saldoAntes);
  const total = base + qtdCompra;
  if (total <= 0) return custoCompra;
  return (base * custoAntes + qtdCompra * custoCompra) / total;
}

/**
 * ERP próprio · entrega 2 — matéria-prima (tecido e aviamento).
 *
 * Mesma regra do estoque de peça: saldo = soma dos movimentos, nunca editado.
 * A compra é o único movimento que mexe no custo médio, e roda sob lock da
 * linha do insumo — duas compras simultâneas não leem o mesmo saldo/custo.
 * Gate: `config.erpInterno.ativo` (o EstoqueService decide).
 */
@Injectable()
export class InsumosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: EstoqueService,
  ) {}

  private async saldos(empresaId: string, ids?: string[]) {
    const g = await this.prisma.insumoMovimento.groupBy({
      by: ['insumoId'],
      where: { empresaId, ...(ids ? { insumoId: { in: ids } } : {}) },
      _sum: { quantidade: true },
    });
    return new Map(g.map((x) => [x.insumoId, Number(x._sum.quantidade ?? 0)]));
  }

  private async doInsumo(empresaId: string, id: string) {
    const i = await this.prisma.insumo.findFirst({ where: { id, empresaId } });
    if (!i) throw new NotFoundException('Insumo', id);
    return i;
  }

  private paraTela(i: Prisma.InsumoGetPayload<object>, saldo: number) {
    const custoMedio = Number(i.custoMedio);
    const minimo = num(i.estoqueMinimo);
    return {
      id: i.id,
      nome: i.nome,
      tipo: i.tipo,
      unidade: i.unidade,
      cor: i.cor,
      fornecedor: i.fornecedor,
      ativo: i.ativo,
      custoMedio,
      estoqueMinimo: minimo,
      saldo,
      valorEmEstoque: Math.max(0, saldo) * custoMedio,
      repor: minimo !== null && saldo < minimo,
    };
  }

  async listar(user: AuthenticatedUser) {
    const empresaId = await this.erp.empresaLigada(user);
    const [insumos, saldos] = await Promise.all([
      this.prisma.insumo.findMany({
        where: { empresaId },
        orderBy: [{ ativo: 'desc' }, { tipo: 'asc' }, { nome: 'asc' }],
      }),
      this.saldos(empresaId),
    ]);
    return insumos.map((i) => this.paraTela(i, saldos.get(i.id) ?? 0));
  }

  async criar(user: AuthenticatedUser, dto: InsumoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const i = await this.prisma.insumo.create({
      data: {
        empresaId,
        nome: dto.nome,
        tipo: dto.tipo,
        unidade: dto.unidade,
        cor: dto.cor ?? null,
        fornecedor: dto.fornecedor ?? null,
        estoqueMinimo: dto.estoqueMinimo == null ? null : D(dto.estoqueMinimo, 3),
        ativo: dto.ativo ?? true,
      },
    });
    return this.paraTela(i, 0);
  }

  async atualizar(user: AuthenticatedUser, id: string, dto: InsumoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const atual = await this.doInsumo(empresaId, id);
    // Trocar a unidade com saldo lançado reinterpreta tudo o que já entrou
    // (20 "kg" virariam 20 "metros"). Só sem movimento.
    if (dto.unidade !== atual.unidade) {
      const temMov = await this.prisma.insumoMovimento.count({ where: { insumoId: id } });
      if (temMov > 0) {
        throw new BusinessRuleException(
          'Este insumo já tem movimentação — a unidade não pode mudar. Crie outro insumo com a unidade nova.',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
    }
    const i = await this.prisma.insumo.update({
      where: { id },
      data: {
        nome: dto.nome,
        tipo: dto.tipo,
        unidade: dto.unidade,
        cor: dto.cor ?? null,
        fornecedor: dto.fornecedor ?? null,
        estoqueMinimo: dto.estoqueMinimo == null ? null : D(dto.estoqueMinimo, 3),
        ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
      },
    });
    const saldos = await this.saldos(empresaId, [id]);
    return this.paraTela(i, saldos.get(id) ?? 0);
  }

  /** Só exclui insumo sem movimento; com histórico, desative. */
  async excluir(user: AuthenticatedUser, id: string) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.doInsumo(empresaId, id);
    const temMov = await this.prisma.insumoMovimento.count({ where: { insumoId: id } });
    if (temMov > 0) {
      throw new BusinessRuleException(
        'Este insumo tem histórico — desative em vez de excluir',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    const emFicha = await this.prisma.fichaTecnicaItem.count({ where: { insumoId: id } });
    if (emFicha > 0) {
      throw new BusinessRuleException(
        `Este insumo está em ${emFicha} ficha(s) técnica(s) — tire de lá antes, ou desative`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    await this.prisma.insumo.delete({ where: { id } });
    return { ok: true };
  }

  /** Entrada de compra: soma no saldo e recalcula o custo médio ponderado. */
  async comprar(user: AuthenticatedUser, id: string, dto: CompraInsumoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.doInsumo(empresaId, id);
    await this.prisma.$transaction(async (tx) => {
      // Lock da linha: a média depende do saldo e do custo LIDOS AGORA.
      const [linha] = await tx.$queryRaw<Array<{ custoMedio: Prisma.Decimal }>>`
        SELECT "custoMedio" FROM "Insumo" WHERE "id" = ${id} FOR UPDATE`;
      const soma = await tx.insumoMovimento.aggregate({
        where: { insumoId: id },
        _sum: { quantidade: true },
      });
      const custo = novoCustoMedio(
        Number(soma._sum.quantidade ?? 0),
        Number(linha?.custoMedio ?? 0),
        dto.quantidade,
        dto.custoUnitario,
      );
      await tx.insumoMovimento.create({
        data: {
          empresaId,
          insumoId: id,
          tipo: 'ENTRADA_COMPRA',
          quantidade: D(dto.quantidade, 3),
          custoUnitario: D(dto.custoUnitario, 4),
          documento: dto.documento ?? null,
          motivo: dto.motivo ?? null,
          usuarioId: user.id,
        },
      });
      await tx.insumo.update({ where: { id }, data: { custoMedio: D(custo, 4) } });
    });
    return this.listarUm(empresaId, id);
  }

  /** Perda, sobra que voltou ou ajuste — motivo obrigatório; custo não muda. */
  async movimentar(user: AuthenticatedUser, id: string, dto: MovimentoInsumoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.doInsumo(empresaId, id);
    const qtd =
      dto.tipo === 'PERDA'
        ? -Math.abs(dto.quantidade)
        : dto.tipo === 'SOBRA_RETORNO'
          ? Math.abs(dto.quantidade)
          : dto.quantidade;
    await this.prisma.insumoMovimento.create({
      data: {
        empresaId,
        insumoId: id,
        tipo: dto.tipo,
        quantidade: D(qtd, 3),
        motivo: dto.motivo,
        documento: dto.documento ?? null,
        usuarioId: user.id,
      },
    });
    return this.listarUm(empresaId, id);
  }

  async movimentos(user: AuthenticatedUser, id: string) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.doInsumo(empresaId, id);
    const ms = await this.prisma.insumoMovimento.findMany({
      where: { insumoId: id },
      orderBy: { criadoEm: 'desc' },
      take: 200,
      select: {
        id: true,
        tipo: true,
        quantidade: true,
        custoUnitario: true,
        motivo: true,
        documento: true,
        criadoEm: true,
      },
    });
    return ms.map((m) => ({
      ...m,
      quantidade: Number(m.quantidade),
      custoUnitario: num(m.custoUnitario),
    }));
  }

  private async listarUm(empresaId: string, id: string) {
    const i = await this.doInsumo(empresaId, id);
    const saldos = await this.saldos(empresaId, [id]);
    return this.paraTela(i, saldos.get(id) ?? 0);
  }
}
