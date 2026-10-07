import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type FinTipo } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  BaixaDto,
  BaixaEmMassaDto,
  CategoriaDto,
  ContaDto,
  EditarTituloDto,
  ListarTitulosDto,
  RecorrenciaDto,
  TituloDto,
} from './financeiro.dto';
import {
  centavos,
  dataPura,
  hojePuro,
  reais,
  situacao,
  somarMeses,
  statusPelasBaixas,
  vencimentoNoMes,
} from './financeiro.regras';

type Tx = Prisma.TransactionClient;
const D = (v: number) => new Prisma.Decimal(v.toFixed(2));
const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

/** Lista padrão de confecção (Léo, 07/10) — editável na tela. */
export const CATEGORIAS_PADRAO: Record<FinTipo, string[]> = {
  RECEBER: ['Venda atacado', 'Outras receitas'],
  PAGAR: [
    'Facção',
    'Tecido',
    'Aviamento',
    'Embalagem',
    'Frete',
    'Anúncio',
    'Aluguel',
    'Contador',
    'Sistemas',
    'Impostos',
    'Pró-labore',
    'Outras despesas',
  ],
};
/** Contas que existem hoje (Léo, 07/10): banco e Asaas. */
export const CONTAS_PADRAO = [
  { nome: 'Banco', tipo: 'BANCO' },
  { nome: 'Asaas', tipo: 'ASAAS' },
];

/**
 * ERP próprio · Fase 3 — contas a pagar e a receber (sem NF-e).
 *
 * 🔒 Ligado por `Empresa.config.financeiro.ativo` (só a migration liga) e só
 * ADMIN/DIRECTOR (controller). Sem a flag: 422 e nada é lido nem gravado.
 *
 * Saldo de um título = valor − baixas não estornadas. A baixa roda sob trava
 * da linha do título: duas baixas simultâneas não pagam o mesmo saldo duas
 * vezes. Saldo de conta = saldo inicial + recebido − pago (baixas válidas).
 */
@Injectable()
export class FinanceiroService {
  private readonly logger = new Logger(FinanceiroService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Flag ───────────────────────────────────────────────────────────────

  async ativoNaEmpresa(empresaId: string): Promise<boolean> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    return (e?.config as { financeiro?: { ativo?: boolean } } | null)?.financeiro?.ativo === true;
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  async empresaLigada(user: AuthenticatedUser): Promise<string> {
    const empresaId = this.requireEmpresa(user);
    if (!(await this.ativoNaEmpresa(empresaId))) {
      throw new BusinessRuleException('O financeiro não está ligado nesta empresa');
    }
    await this.garantirPadroes(empresaId);
    return empresaId;
  }

  async status(user: AuthenticatedUser): Promise<{ ativo: boolean }> {
    return { ativo: await this.ativoNaEmpresa(this.requireEmpresa(user)) };
  }

  /** Primeira vez: categorias padrão e as contas Banco/Asaas. Idempotente. */
  async garantirPadroes(empresaId: string) {
    const tem = await this.prisma.finCategoria.count({ where: { empresaId } });
    if (tem === 0) {
      await this.prisma.finCategoria.createMany({
        data: (['RECEBER', 'PAGAR'] as const).flatMap((tipo) =>
          CATEGORIAS_PADRAO[tipo].map((nome, ordem) => ({ empresaId, tipo, nome, ordem })),
        ),
        skipDuplicates: true,
      });
    }
    const contas = await this.prisma.finConta.count({ where: { empresaId } });
    if (contas === 0) {
      await this.prisma.finConta.createMany({
        data: CONTAS_PADRAO.map((c) => ({ empresaId, ...c })),
        skipDuplicates: true,
      });
    }
  }

  // ─── Títulos ────────────────────────────────────────────────────────────

  private async tituloDaEmpresa(empresaId: string, id: string) {
    const t = await this.prisma.finTitulo.findFirst({ where: { id, empresaId } });
    if (!t) throw new NotFoundException('Lançamento', id);
    return t;
  }

  private async categoriaValida(empresaId: string, tipo: FinTipo, categoriaId?: string | null) {
    if (!categoriaId) return null;
    const c = await this.prisma.finCategoria.findFirst({
      where: { id: categoriaId, empresaId, tipo },
      select: { id: true },
    });
    if (!c) throw regra('Categoria não existe (ou é do outro lado: receita × despesa)');
    return c.id;
  }

  async listar(user: AuthenticatedUser, f: ListarTitulosDto) {
    const empresaId = await this.empresaLigada(user);
    const hoje = hojePuro();
    const where: Prisma.FinTituloWhereInput = {
      empresaId,
      tipo: f.tipo,
      ...(f.categoriaId ? { categoriaId: f.categoriaId } : {}),
      ...(f.de || f.ate
        ? {
            vencimento: {
              ...(f.de ? { gte: dataPura(f.de) } : {}),
              ...(f.ate ? { lte: dataPura(f.ate) } : {}),
            },
          }
        : {}),
      ...(f.busca
        ? {
            OR: [
              { descricao: { contains: f.busca, mode: 'insensitive' } },
              { contatoNome: { contains: f.busca, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(f.situacao === 'ABERTO'
        ? { status: { in: ['ABERTO', 'PARCIAL'] } }
        : f.situacao === 'VENCIDO'
          ? { status: { in: ['ABERTO', 'PARCIAL'] }, vencimento: { lt: hoje } }
          : f.situacao === 'QUITADO'
            ? { status: 'QUITADO' }
            : f.situacao === 'CANCELADO'
              ? { status: 'CANCELADO' }
              : {}),
    };
    const titulos = await this.prisma.finTitulo.findMany({
      where,
      orderBy: [{ vencimento: 'asc' }, { criadoEm: 'asc' }],
      take: 1000,
      include: {
        categoria: { select: { id: true, nome: true } },
        baixas: {
          where: { estornadaEm: null },
          select: { id: true, valor: true, data: true, forma: true, contaId: true },
        },
      },
    });
    const linhas = titulos.map((t) => {
      const valorC = centavos(Number(t.valor));
      const pagoC = t.baixas.reduce((s, b) => s + centavos(Number(b.valor)), 0);
      return {
        id: t.id,
        tipo: t.tipo,
        descricao: t.descricao,
        valor: reais(valorC),
        pago: reais(pagoC),
        saldo: reais(Math.max(0, valorC - pagoC)),
        vencimento: t.vencimento,
        status: t.status,
        situacao: situacao(t.status, t.vencimento, hoje),
        categoria: t.categoria,
        contatoNome: t.contatoNome,
        observacoes: t.observacoes,
        pedidoId: t.pedidoId,
        parcela: t.parcela,
        totalParcelas: t.totalParcelas,
        recorrente: Boolean(t.recorrenciaId),
        automatico: Boolean(t.pedidoId || t.opEntregaId || t.opSaldoId || t.insumoMovimentoId),
      };
    });
    // Totais da empresa toda (não só do filtro): o topo da tela.
    const totais = await this.totais(empresaId, f.tipo, hoje);
    return { titulos: linhas, totais };
  }

  /** Em aberto, vencido e quitado no mês corrente — pros números do topo. */
  private async totais(empresaId: string, tipo: FinTipo, hoje: Date) {
    const abertos = await this.prisma.finTitulo.findMany({
      where: { empresaId, tipo, status: { in: ['ABERTO', 'PARCIAL'] } },
      select: {
        valor: true,
        vencimento: true,
        baixas: { where: { estornadaEm: null }, select: { valor: true } },
      },
    });
    let abertoC = 0;
    let vencidoC = 0;
    for (const t of abertos) {
      const saldo =
        centavos(Number(t.valor)) - t.baixas.reduce((s, b) => s + centavos(Number(b.valor)), 0);
      abertoC += Math.max(0, saldo);
      if (t.vencimento < hoje) vencidoC += Math.max(0, saldo);
    }
    const inicioMes = vencimentoNoMes(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1);
    inicioMes.setUTCHours(0);
    const noMes = await this.prisma.finBaixa.aggregate({
      where: { estornadaEm: null, data: { gte: inicioMes }, titulo: { empresaId, tipo } },
      _sum: { valor: true },
    });
    return {
      emAberto: reais(abertoC),
      vencido: reais(vencidoC),
      quitadoNoMes: Number(noMes._sum.valor ?? 0),
    };
  }

  async criar(user: AuthenticatedUser, dto: TituloDto) {
    const empresaId = await this.empresaLigada(user);
    const categoriaId = await this.categoriaValida(empresaId, dto.tipo, dto.categoriaId);
    const primeiro = dataPura(dto.vencimento);
    const n = dto.parcelas ?? 1;
    await this.prisma.finTitulo.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        empresaId,
        tipo: dto.tipo,
        descricao: n > 1 ? `${dto.descricao} (${i + 1}/${n})` : dto.descricao,
        valor: D(dto.valor),
        vencimento: somarMeses(primeiro, i),
        categoriaId,
        contatoNome: dto.contatoNome ?? null,
        observacoes: dto.observacoes ?? null,
        usuarioId: user.id,
      })),
    });
    return { criados: n };
  }

  /** Editar: valor só sem baixa (senão o saldo das baixas fica sem sentido). */
  async editar(user: AuthenticatedUser, id: string, dto: EditarTituloDto) {
    const empresaId = await this.empresaLigada(user);
    const t = await this.tituloDaEmpresa(empresaId, id);
    if (t.status === 'CANCELADO' || t.status === 'QUITADO')
      throw regra('Lançamento fechado não se edita');
    const baixas = await this.prisma.finBaixa.count({ where: { tituloId: id, estornadaEm: null } });
    if (baixas > 0 && centavos(dto.valor) !== centavos(Number(t.valor))) {
      throw regra('Já tem baixa — estorne a baixa antes de mudar o valor');
    }
    const categoriaId = await this.categoriaValida(empresaId, t.tipo, dto.categoriaId);
    await this.prisma.finTitulo.update({
      where: { id },
      data: {
        descricao: dto.descricao,
        valor: D(dto.valor),
        vencimento: dataPura(dto.vencimento),
        categoriaId,
        contatoNome: dto.contatoNome ?? null,
        observacoes: dto.observacoes ?? null,
      },
    });
    return { ok: true };
  }

  async cancelar(user: AuthenticatedUser, id: string) {
    const empresaId = await this.empresaLigada(user);
    await this.tituloDaEmpresa(empresaId, id);
    const baixas = await this.prisma.finBaixa.count({ where: { tituloId: id, estornadaEm: null } });
    if (baixas > 0) throw regra('Já tem baixa — estorne antes de cancelar');
    await this.prisma.finTitulo.update({ where: { id }, data: { status: 'CANCELADO' } });
    return { ok: true };
  }

  private async contaDaEmpresa(empresaId: string, contaId: string) {
    const c = await this.prisma.finConta.findFirst({
      where: { id: contaId, empresaId, ativo: true },
    });
    if (!c) throw new NotFoundException('Conta', contaId);
  }

  /** Recalcula o status pelo que foi pago (dentro da transação de quem chamou). */
  async reaplicarStatus(tx: Tx, tituloId: string) {
    const t = await tx.finTitulo.findUniqueOrThrow({
      where: { id: tituloId },
      select: {
        valor: true,
        status: true,
        baixas: { where: { estornadaEm: null }, select: { valor: true } },
      },
    });
    if (t.status === 'CANCELADO') return;
    const pagoC = t.baixas.reduce((s, b) => s + centavos(Number(b.valor)), 0);
    await tx.finTitulo.update({
      where: { id: tituloId },
      data: { status: statusPelasBaixas(centavos(Number(t.valor)), pagoC) },
    });
  }

  /** Baixa (total ou parcial). Trava a linha do título: sem pagar duas vezes. */
  async baixar(user: AuthenticatedUser, id: string, dto: BaixaDto) {
    const empresaId = await this.empresaLigada(user);
    await this.tituloDaEmpresa(empresaId, id);
    await this.contaDaEmpresa(empresaId, dto.contaId);
    await this.prisma.$transaction((tx) => this.baixarNaTx(tx, id, dto, user.id));
    return { ok: true };
  }

  /** Baixa dentro da transação de quem chamou (também usada pelos lançamentos automáticos). */
  async baixarNaTx(tx: Tx, id: string, dto: BaixaDto, usuarioId: string | null) {
    await tx.$queryRaw`SELECT "id" FROM "FinTitulo" WHERE "id" = ${id} FOR UPDATE`;
    const t = await tx.finTitulo.findUniqueOrThrow({
      where: { id },
      select: {
        valor: true,
        status: true,
        baixas: { where: { estornadaEm: null }, select: { valor: true } },
      },
    });
    if (t.status === 'CANCELADO') throw regra('Lançamento cancelado não recebe baixa');
    const saldoC =
      centavos(Number(t.valor)) - t.baixas.reduce((s, b) => s + centavos(Number(b.valor)), 0);
    if (saldoC <= 0) throw regra('Este lançamento já está quitado');
    if (centavos(dto.valor) > saldoC) {
      throw regra(
        `A baixa passa do que falta (falta ${reais(saldoC).toFixed(2).replace('.', ',')})`,
      );
    }
    await tx.finBaixa.create({
      data: {
        tituloId: id,
        contaId: dto.contaId,
        valor: D(dto.valor),
        data: dataPura(dto.data),
        forma: dto.forma ?? null,
        observacao: dto.observacao ?? null,
        usuarioId,
      },
    });
    await this.reaplicarStatus(tx, id);
  }

  /** Baixa em massa: cada título pelo saldo que falta, na mesma conta e data. */
  async baixarEmMassa(user: AuthenticatedUser, dto: BaixaEmMassaDto) {
    const empresaId = await this.empresaLigada(user);
    await this.contaDaEmpresa(empresaId, dto.contaId);
    const titulos = await this.prisma.finTitulo.findMany({
      where: { empresaId, id: { in: dto.ids }, status: { in: ['ABERTO', 'PARCIAL'] } },
      select: {
        id: true,
        valor: true,
        baixas: { where: { estornadaEm: null }, select: { valor: true } },
      },
    });
    let n = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const t of titulos) {
        const saldoC =
          centavos(Number(t.valor)) - t.baixas.reduce((s, b) => s + centavos(Number(b.valor)), 0);
        if (saldoC <= 0) continue;
        await this.baixarNaTx(
          tx,
          t.id,
          {
            valor: reais(saldoC),
            data: dto.data,
            contaId: dto.contaId,
            forma: dto.forma ?? null,
            observacao: 'Baixa em massa',
          },
          user.id,
        );
        n++;
      }
    });
    return { baixados: n };
  }

  /** Desfaz uma baixa lançada errado (fica no histórico como estornada). */
  async estornarBaixa(user: AuthenticatedUser, baixaId: string) {
    const empresaId = await this.empresaLigada(user);
    const b = await this.prisma.finBaixa.findFirst({
      where: { id: baixaId, estornadaEm: null, titulo: { empresaId } },
      select: { id: true, tituloId: true },
    });
    if (!b) throw new NotFoundException('Baixa', baixaId);
    await this.prisma.$transaction(async (tx) => {
      await tx.finBaixa.update({ where: { id: b.id }, data: { estornadaEm: new Date() } });
      await this.reaplicarStatus(tx, b.tituloId);
    });
    return { ok: true };
  }

  async baixasDoTitulo(user: AuthenticatedUser, id: string) {
    const empresaId = await this.empresaLigada(user);
    await this.tituloDaEmpresa(empresaId, id);
    const bs = await this.prisma.finBaixa.findMany({
      where: { tituloId: id },
      orderBy: { data: 'asc' },
      include: { conta: { select: { nome: true } } },
    });
    return bs.map((b) => ({
      id: b.id,
      valor: Number(b.valor),
      data: b.data,
      forma: b.forma,
      observacao: b.observacao,
      conta: b.conta.nome,
      estornadaEm: b.estornadaEm,
    }));
  }

  // ─── Categorias e contas ────────────────────────────────────────────────

  async categorias(user: AuthenticatedUser) {
    const empresaId = await this.empresaLigada(user);
    return this.prisma.finCategoria.findMany({
      where: { empresaId },
      orderBy: [{ tipo: 'asc' }, { ordem: 'asc' }, { nome: 'asc' }],
      select: { id: true, tipo: true, nome: true, ativo: true },
    });
  }

  async salvarCategoria(user: AuthenticatedUser, dto: CategoriaDto, id?: string) {
    const empresaId = await this.empresaLigada(user);
    try {
      if (id) {
        const c = await this.prisma.finCategoria.findFirst({ where: { id, empresaId } });
        if (!c) throw new NotFoundException('Categoria', id);
        return await this.prisma.finCategoria.update({
          where: { id },
          data: { nome: dto.nome, ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}) },
        });
      }
      return await this.prisma.finCategoria.create({
        data: { empresaId, tipo: dto.tipo, nome: dto.nome, ordem: 100 },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw regra(`Já existe a categoria "${dto.nome}"`);
      }
      throw e;
    }
  }

  async contas(user: AuthenticatedUser) {
    const empresaId = await this.empresaLigada(user);
    const contas = await this.prisma.finConta.findMany({
      where: { empresaId },
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    });
    const mov = await this.prisma.finBaixa.groupBy({
      by: ['contaId'],
      where: { estornadaEm: null, conta: { empresaId }, titulo: { tipo: 'RECEBER' } },
      _sum: { valor: true },
    });
    const sai = await this.prisma.finBaixa.groupBy({
      by: ['contaId'],
      where: { estornadaEm: null, conta: { empresaId }, titulo: { tipo: 'PAGAR' } },
      _sum: { valor: true },
    });
    const entrou = new Map(mov.map((m) => [m.contaId, centavos(Number(m._sum.valor ?? 0))]));
    const saiu = new Map(sai.map((m) => [m.contaId, centavos(Number(m._sum.valor ?? 0))]));
    return contas.map((c) => ({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
      ativo: c.ativo,
      saldoInicial: Number(c.saldoInicial),
      // Saldo = inicial + recebido − pago (baixas válidas).
      saldo: reais(
        centavos(Number(c.saldoInicial)) + (entrou.get(c.id) ?? 0) - (saiu.get(c.id) ?? 0),
      ),
    }));
  }

  async salvarConta(user: AuthenticatedUser, dto: ContaDto, id?: string) {
    const empresaId = await this.empresaLigada(user);
    const data = {
      nome: dto.nome,
      tipo: dto.tipo,
      saldoInicial: D(dto.saldoInicial ?? 0),
      ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
    };
    try {
      if (id) {
        const c = await this.prisma.finConta.findFirst({ where: { id, empresaId } });
        if (!c) throw new NotFoundException('Conta', id);
        return await this.prisma.finConta.update({ where: { id }, data });
      }
      return await this.prisma.finConta.create({ data: { empresaId, ...data } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw regra(`Já existe a conta "${dto.nome}"`);
      }
      throw e;
    }
  }

  // ─── Recorrentes ────────────────────────────────────────────────────────

  async recorrencias(user: AuthenticatedUser) {
    const empresaId = await this.empresaLigada(user);
    const rs = await this.prisma.finRecorrencia.findMany({
      where: { empresaId },
      orderBy: [{ ativo: 'desc' }, { tipo: 'asc' }, { dia: 'asc' }],
      include: { categoria: { select: { id: true, nome: true } } },
    });
    return rs.map((r) => ({ ...r, valor: Number(r.valor) }));
  }

  async salvarRecorrencia(user: AuthenticatedUser, dto: RecorrenciaDto, id?: string) {
    const empresaId = await this.empresaLigada(user);
    const categoriaId = await this.categoriaValida(empresaId, dto.tipo, dto.categoriaId);
    const data = {
      tipo: dto.tipo,
      descricao: dto.descricao,
      valor: D(dto.valor),
      dia: dto.dia,
      categoriaId,
      contatoNome: dto.contatoNome ?? null,
      ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
    };
    let rid = id;
    if (id) {
      const r = await this.prisma.finRecorrencia.findFirst({ where: { id, empresaId } });
      if (!r) throw new NotFoundException('Recorrente', id);
      await this.prisma.finRecorrencia.update({ where: { id }, data });
    } else {
      rid = (
        await this.prisma.finRecorrencia.create({
          data: { empresaId, ...data },
          select: { id: true },
        })
      ).id;
    }
    // Já gera os lançamentos deste mês e do próximo.
    await this.gerarRecorrentes(new Date(), rid);
    return { id: rid };
  }

  /**
   * Garante o lançamento deste mês e do próximo pra cada recorrente ativa.
   * Idempotente: único por (recorrência, vencimento). O job roda todo dia.
   */
  async gerarRecorrentes(agora = new Date(), soEsta?: string): Promise<number> {
    const hoje = hojePuro(agora);
    const rs = await this.prisma.finRecorrencia.findMany({
      where: { ativo: true, ...(soEsta ? { id: soEsta } : {}) },
    });
    let criados = 0;
    for (const r of rs) {
      for (const m of [0, 1]) {
        const venc = vencimentoNoMes(hoje.getUTCFullYear(), hoje.getUTCMonth() + m, r.dia);
        const res = await this.prisma.finTitulo.createMany({
          data: [
            {
              empresaId: r.empresaId,
              tipo: r.tipo,
              descricao: r.descricao,
              valor: r.valor,
              vencimento: venc,
              categoriaId: r.categoriaId,
              contatoNome: r.contatoNome,
              recorrenciaId: r.id,
            },
          ],
          skipDuplicates: true,
        });
        criados += res.count;
      }
    }
    if (criados) this.logger.log(`[financeiro] ${criados} lançamento(s) recorrente(s) gerado(s)`);
    return criados;
  }
}
