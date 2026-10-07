import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { FinanceiroAutomaticoService } from '@modules/financeiro/financeiro-automatico.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EstoqueService } from './estoque.service';
import type { CompraInsumoDto, InsumoDto, MovimentoInsumoDto } from './insumos.dto';

type Tx = Prisma.TransactionClient;
const D = (v: number, casas: number) => new Prisma.Decimal(v.toFixed(casas));
const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

/** Chave do saldo: insumo sem cor usa só o id; com cor, id + cor do insumo. */
export const chaveSaldo = (insumoId: string, insumoCorId: string | null | undefined) =>
  `${insumoId}|${insumoCorId ?? ''}`;

/**
 * Custo do insumo inteiro quando ele tem cores: média das cores que já têm
 * custo (é o que a ficha usa quando não fixa uma cor). Nenhuma com custo = 0.
 */
export function custoMedioDasCores(custos: number[]): number {
  const com = custos.filter((c) => c > 0);
  return com.length ? com.reduce((a, b) => a + b, 0) / com.length : 0;
}

const INCLUI_CORES = {
  cores: {
    select: {
      id: true,
      corId: true,
      custoMedio: true,
      ativo: true,
      cor: { select: { nome: true, hex: true, ordem: true } },
    },
  },
} as const;
type InsumoComCores = Prisma.InsumoGetPayload<{ include: typeof INCLUI_CORES }>;

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
    // Financeiro (Fase 3): a compra vira conta a pagar do fornecedor.
    @Optional() private readonly fin?: FinanceiroAutomaticoService,
  ) {}

  /** Saldo por insumo E cor (chave `chaveSaldo`). */
  private async saldos(empresaId: string, ids?: string[]) {
    const g = await this.prisma.insumoMovimento.groupBy({
      by: ['insumoId', 'insumoCorId'],
      where: { empresaId, ...(ids ? { insumoId: { in: ids } } : {}) },
      _sum: { quantidade: true },
    });
    return new Map(
      g.map((x) => [chaveSaldo(x.insumoId, x.insumoCorId), Number(x._sum.quantidade ?? 0)]),
    );
  }

  private async doInsumo(empresaId: string, id: string) {
    const i = await this.prisma.insumo.findFirst({ where: { id, empresaId } });
    if (!i) throw new NotFoundException('Insumo', id);
    return i;
  }

  private paraTela(i: InsumoComCores, saldos: Map<string, number>) {
    const minimo = num(i.estoqueMinimo);
    // Cor desligada some, a não ser que ainda tenha saldo (não esconde estoque).
    const cores = i.cores
      .map((c) => {
        const saldo = saldos.get(chaveSaldo(i.id, c.id)) ?? 0;
        const custoMedio = Number(c.custoMedio);
        return {
          id: c.id,
          corId: c.corId,
          nome: c.cor.nome,
          hex: c.cor.hex,
          ordem: c.cor.ordem,
          ativo: c.ativo,
          custoMedio,
          saldo,
          valorEmEstoque: Math.max(0, saldo) * custoMedio,
          // O mínimo do insumo vale pra CADA cor.
          repor: minimo !== null && c.ativo && saldo < minimo,
        };
      })
      .filter((c) => c.ativo || Math.abs(c.saldo) > 0.0005)
      .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
      .map(({ ordem: _o, ...c }) => c);
    const temCores = i.cores.length > 0;
    const saldo = temCores
      ? cores.reduce((s, c) => s + c.saldo, 0)
      : (saldos.get(chaveSaldo(i.id, null)) ?? 0);
    const custoMedio = Number(i.custoMedio);
    return {
      id: i.id,
      nome: i.nome,
      tipo: i.tipo,
      unidade: i.unidade,
      cor: i.cor,
      fornecedor: i.fornecedor,
      ativo: i.ativo,
      /** Com cores: média das cores com custo (o que a ficha usa sem cor fixa). */
      custoMedio,
      estoqueMinimo: minimo,
      saldo,
      valorEmEstoque: temCores
        ? cores.reduce((s, c) => s + c.valorEmEstoque, 0)
        : Math.max(0, saldo) * custoMedio,
      repor: temCores ? cores.some((c) => c.repor) : minimo !== null && saldo < minimo,
      temCores,
      cores,
    };
  }

  async listar(user: AuthenticatedUser) {
    const empresaId = await this.erp.empresaLigada(user);
    const [insumos, saldos] = await Promise.all([
      this.prisma.insumo.findMany({
        where: { empresaId },
        orderBy: [{ ativo: 'desc' }, { tipo: 'asc' }, { nome: 'asc' }],
        include: INCLUI_CORES,
      }),
      this.saldos(empresaId),
    ]);
    return insumos.map((i) => this.paraTela(i, saldos));
  }

  /** Lista de cores da empresa (a mesma da vitrine) — sem depender da vitrine ligada. */
  async coresDaEmpresa(user: AuthenticatedUser) {
    const empresaId = await this.erp.empresaLigada(user);
    return this.prisma.catalogoCor.findMany({
      where: { empresaId },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true, hex: true, ativo: true },
    });
  }

  /** As cores pedidas existem na lista da empresa (a mesma da vitrine)? */
  private async conferirCores(empresaId: string, corIds: string[]) {
    if (!corIds.length) return;
    const n = await this.prisma.catalogoCor.count({
      where: { empresaId, id: { in: corIds } },
    });
    if (n !== new Set(corIds).size)
      throw regra('Alguma cor não existe na lista de cores da empresa');
  }

  /**
   * Deixa o insumo com EXATAMENTE estas cores. Cor nova entra; cor tirada sem
   * histórico sai; com histórico, só desliga (o histórico e o saldo ficam).
   * Insumo que já movimentou SEM cor não ganha cores: o saldo sem cor não
   * teria pra onde ir.
   */
  private async sincronizarCores(tx: Tx, empresaId: string, insumoId: string, corIds: string[]) {
    const atuais = await tx.insumoCor.findMany({
      where: { insumoId },
      select: { id: true, corId: true, ativo: true },
    });
    const querer = new Set(corIds);
    const novas = corIds.filter((c) => !atuais.some((a) => a.corId === c));
    if (novas.length && !atuais.length) {
      const semCor = await tx.insumoMovimento.count({ where: { insumoId, insumoCorId: null } });
      if (semCor > 0) {
        throw regra(
          'Este insumo já tem movimentação sem cor — pra separar por cor, crie um insumo novo com as cores',
        );
      }
    }
    if (novas.length) {
      await tx.insumoCor.createMany({
        data: novas.map((corId) => ({ empresaId, insumoId, corId })),
      });
    }
    for (const a of atuais) {
      if (querer.has(a.corId)) {
        if (!a.ativo) await tx.insumoCor.update({ where: { id: a.id }, data: { ativo: true } });
        continue;
      }
      const usada =
        (await tx.insumoMovimento.count({ where: { insumoCorId: a.id } })) +
        (await tx.ordemProducaoConsumo.count({ where: { insumoCorId: a.id } }));
      if (usada > 0) {
        if (a.ativo) await tx.insumoCor.update({ where: { id: a.id }, data: { ativo: false } });
      } else {
        await tx.insumoCor.delete({ where: { id: a.id } });
      }
    }
    // Ficha que fixava uma cor que o insumo não tem mais ficaria apontando pro nada.
    const fixadas = await tx.fichaTecnicaItem.count({
      where: { insumoId, corFixaId: { not: null, notIn: corIds } },
    });
    if (fixadas > 0) {
      throw regra(
        `Há ${fixadas} ficha(s) técnica(s) que fixam uma cor que você está tirando — ajuste a ficha antes`,
      );
    }
  }

  private async umComSaldo(empresaId: string, id: string) {
    const i = await this.prisma.insumo.findFirst({
      where: { id, empresaId },
      include: INCLUI_CORES,
    });
    if (!i) throw new NotFoundException('Insumo', id);
    return this.paraTela(i, await this.saldos(empresaId, [id]));
  }

  async criar(user: AuthenticatedUser, dto: InsumoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const corIds = dto.cores ?? [];
    await this.conferirCores(empresaId, corIds);
    const i = await this.prisma.$transaction(async (tx) => {
      const novo = await tx.insumo.create({
        data: {
          empresaId,
          nome: dto.nome,
          tipo: dto.tipo,
          unidade: dto.unidade,
          // Com cores da lista, o texto livre não vale mais.
          cor: corIds.length ? null : (dto.cor ?? null),
          fornecedor: dto.fornecedor ?? null,
          estoqueMinimo: dto.estoqueMinimo == null ? null : D(dto.estoqueMinimo, 3),
          ativo: dto.ativo ?? true,
        },
        select: { id: true },
      });
      if (corIds.length) await this.sincronizarCores(tx, empresaId, novo.id, corIds);
      return novo;
    });
    return this.umComSaldo(empresaId, i.id);
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
    if (dto.cores) await this.conferirCores(empresaId, dto.cores);
    await this.prisma.$transaction(async (tx) => {
      // `cores` ausente = não mexe nas cores (tela antiga / só renomear).
      if (dto.cores) await this.sincronizarCores(tx, empresaId, id, dto.cores);
      const temCores = (await tx.insumoCor.count({ where: { insumoId: id } })) > 0;
      await tx.insumo.update({
        where: { id },
        data: {
          nome: dto.nome,
          tipo: dto.tipo,
          unidade: dto.unidade,
          cor: temCores ? null : (dto.cor ?? null),
          fornecedor: dto.fornecedor ?? null,
          estoqueMinimo: dto.estoqueMinimo == null ? null : D(dto.estoqueMinimo, 3),
          ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
        },
      });
      if (temCores) await this.recalcularMediaDasCores(tx, id);
    });
    return this.umComSaldo(empresaId, id);
  }

  /** Insumo.custoMedio de quem tem cores = média das cores (ativas) com custo. */
  private async recalcularMediaDasCores(tx: Tx, insumoId: string) {
    const cs = await tx.insumoCor.findMany({
      where: { insumoId, ativo: true },
      select: { custoMedio: true },
    });
    await tx.insumo.update({
      where: { id: insumoId },
      data: { custoMedio: D(custoMedioDasCores(cs.map((c) => Number(c.custoMedio))), 4) },
    });
  }

  /**
   * Resolve a cor de um movimento: insumo com cores EXIGE uma cor dele (ativa);
   * sem cores, não aceita cor. Devolve o id da cor do insumo (ou null).
   */
  private async corDoMovimento(
    insumoId: string,
    insumoCorId: string | null | undefined,
  ): Promise<string | null> {
    const cores = await this.prisma.insumoCor.findMany({
      where: { insumoId },
      select: { id: true, ativo: true },
    });
    if (!cores.length) {
      if (insumoCorId) throw regra('Este insumo não tem cores — lance sem cor');
      return null;
    }
    if (!insumoCorId) throw regra('Escolha a cor deste insumo');
    const c = cores.find((x) => x.id === insumoCorId);
    if (!c) throw regra('Esta cor não é deste insumo');
    if (!c.ativo) throw regra('Esta cor foi tirada do insumo — religue a cor no cadastro');
    return c.id;
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
    const corId = await this.corDoMovimento(id, dto.insumoCorId);
    const comFinanceiro = this.fin ? await this.fin.preparar(empresaId) : false;
    await this.prisma.$transaction(async (tx) => {
      // Lock da linha: a média depende do saldo e do custo LIDOS AGORA. Com
      // cor, o custo é o DA COR (e o lock também).
      // O insumo trava SEMPRE (compras de cores diferentes mexem na média geral).
      const [doInsumo] = await tx.$queryRaw<Array<{ custoMedio: Prisma.Decimal }>>`
        SELECT "custoMedio" FROM "Insumo" WHERE "id" = ${id} FOR UPDATE`;
      const linha = corId
        ? await tx.insumoCor.findUnique({ where: { id: corId }, select: { custoMedio: true } })
        : doInsumo;
      const soma = await tx.insumoMovimento.aggregate({
        where: { insumoId: id, insumoCorId: corId },
        _sum: { quantidade: true },
      });
      const custo = novoCustoMedio(
        Number(soma._sum.quantidade ?? 0),
        Number(linha?.custoMedio ?? 0),
        dto.quantidade,
        dto.custoUnitario,
      );
      const mov = await tx.insumoMovimento.create({
        select: { id: true },
        data: {
          empresaId,
          insumoId: id,
          tipo: 'ENTRADA_COMPRA',
          insumoCorId: corId,
          quantidade: D(dto.quantidade, 3),
          custoUnitario: D(dto.custoUnitario, 4),
          documento: dto.documento ?? null,
          motivo: dto.motivo ?? null,
          usuarioId: user.id,
        },
      });
      if (corId) {
        await tx.insumoCor.update({ where: { id: corId }, data: { custoMedio: D(custo, 4) } });
        await this.recalcularMediaDasCores(tx, id);
      } else {
        await tx.insumo.update({ where: { id }, data: { custoMedio: D(custo, 4) } });
      }
      // Financeiro: conta a pagar do fornecedor, com o vencimento informado.
      if (comFinanceiro && this.fin) {
        await this.fin.compraInsumoNaTx(tx, mov.id, {
          vencimento: dto.vencimento ?? null,
          valorTotal: dto.valorTotal ?? null,
        });
      }
    });
    return this.umComSaldo(empresaId, id);
  }

  /** Perda, sobra que voltou ou ajuste — motivo obrigatório; custo não muda. */
  async movimentar(user: AuthenticatedUser, id: string, dto: MovimentoInsumoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.doInsumo(empresaId, id);
    const corId = await this.corDoMovimento(id, dto.insumoCorId);
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
        insumoCorId: corId,
        tipo: dto.tipo,
        quantidade: D(qtd, 3),
        motivo: dto.motivo,
        documento: dto.documento ?? null,
        usuarioId: user.id,
      },
    });
    return this.umComSaldo(empresaId, id);
  }

  /** Histórico do insumo (todas as cores, ou só uma com `insumoCorId`). */
  async movimentos(user: AuthenticatedUser, id: string, insumoCorId?: string) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.doInsumo(empresaId, id);
    const ms = await this.prisma.insumoMovimento.findMany({
      where: { insumoId: id, ...(insumoCorId ? { insumoCorId } : {}) },
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
        insumoCorId: true,
        insumoCor: { select: { cor: { select: { nome: true, hex: true } } } },
      },
    });
    return ms.map(({ insumoCor, ...m }) => ({
      ...m,
      cor: insumoCor?.cor ?? null,
      quantidade: Number(m.quantidade),
      custoUnitario: num(m.custoUnitario),
    }));
  }
}
