import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type OrdemProducaoStatus } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { SequenceService } from '@shared/utils/sequence.service';
import { FinanceiroAutomaticoService } from '@modules/financeiro/financeiro-automatico.service';
import { EstoqueService } from './estoque.service';
import { FichasService } from './fichas.service';
import { chaveSaldo } from './insumos.service';
import type { CorteDto, CriarOpDto, EnvioDto, RecebimentoDto, SimularOpDto } from './ordens.dto';

type Tx = Prisma.TransactionClient;
const D = (v: number, casas: number) => new Prisma.Decimal(v.toFixed(casas));
const n = (v: Prisma.Decimal | null | undefined) => (v == null ? 0 : Number(v));
const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

/** Item da ficha como a OP precisa: consumo + como achar a cor do insumo. */
export interface ItemFichaOp {
  insumoId: string;
  consumoPorPeca: number;
  /** Cor fixada na ficha (cordão sempre Branco). */
  corFixaId?: string | null;
  /** Insumo com cores: corId da lista → id da cor DO insumo. null = sem cores. */
  cores?: Map<string, string> | null;
}

export interface Necessidade {
  insumoId: string;
  /** Cor do insumo que sai do estoque (null = insumo sem cores, ou cor que falta). */
  insumoCorId: string | null;
  /** Cor da lista pedida (null = insumo sem cores). */
  corId: string | null;
  quantidade: number;
  /** O insumo tem cores, mas NÃO esta — não há de onde baixar. */
  semCor: boolean;
}

/**
 * Quanto de cada insumo — e de que COR — a grade pede: Σ (peças × consumo por
 * peça da ficha daquela grade). Insumo com cores sai na cor fixada na ficha
 * ou, sem cor fixa, na cor da própria peça (Moletinho Preto pra bermuda
 * Preta). Insumo sem cores soma tudo junto. Grade sem ficha não entra (a tela
 * avisa). PURO.
 */
export function necessidadesDaGrade(
  pecas: Map<string, Map<string | null, number>>,
  fichas: Map<string, ItemFichaOp[]>,
): Map<string, Necessidade> {
  const out = new Map<string, Necessidade>();
  for (const [linha, porCor] of pecas) {
    for (const i of fichas.get(linha) ?? []) {
      for (const [corDaPeca, qtd] of porCor) {
        let insumoCorId: string | null = null;
        let corId: string | null = null;
        let semCor = false;
        if (i.cores) {
          corId = i.corFixaId ?? corDaPeca;
          insumoCorId = (corId && i.cores.get(corId)) || null;
          semCor = insumoCorId === null;
        }
        const k = `${i.insumoId}|${insumoCorId ?? (semCor ? `sem:${corId ?? ''}` : '')}`;
        const atual = out.get(k) ?? {
          insumoId: i.insumoId,
          insumoCorId,
          corId,
          quantidade: 0,
          semCor,
        };
        atual.quantidade += qtd * i.consumoPorPeca;
        out.set(k, atual);
      }
    }
  }
  return out;
}

/**
 * Rateia o custo REAL da OP entre as grades (Regular, Plus…), porque o tecido
 * do corte é lançado pra OP inteira. O peso de cada grade é o custo previsto
 * pela ficha × peças cortadas (uma peça Plus gasta mais que uma P); grade sem
 * ficha pesa só pelas peças. Custo por peça = parte da grade ÷ peças RECEBIDAS
 * — defeito e peça que não voltou encarecem a boa, que é o custo de verdade.
 */
export function ratearCusto(
  custoTotal: number,
  grades: Array<{
    modeloLinhaId: string;
    cortadas: number;
    recebidas: number;
    previstoPorPeca: number | null;
  }>,
): Array<{ modeloLinhaId: string; pecas: number; custoTotal: number; custoPorPeca: number }> {
  const comPeso = grades.map((g) => ({
    ...g,
    peso: g.cortadas * (g.previstoPorPeca && g.previstoPorPeca > 0 ? g.previstoPorPeca : 1),
  }));
  // Mistura grade com e sem ficha: o peso "1" não é comparável a R$ — aí cai
  // tudo pra peças.
  const misto = grades.some((g) => g.previstoPorPeca) && grades.some((g) => !g.previstoPorPeca);
  const pesos = comPeso.map((g) => (misto ? g.cortadas : g.peso));
  const soma = pesos.reduce((s, p) => s + p, 0);
  return comPeso
    .map((g, i) => {
      const parte = soma > 0 ? (custoTotal * pesos[i]) / soma : 0;
      return {
        modeloLinhaId: g.modeloLinhaId,
        pecas: g.recebidas,
        custoTotal: parte,
        custoPorPeca: g.recebidas > 0 ? parte / g.recebidas : 0,
      };
    })
    .filter((g) => g.pecas > 0);
}

/** Totais da grade de uma OP pra lista e pra situação por facção. */
function resumoDaOp(
  op: Prisma.OrdemProducaoGetPayload<{
    include: {
      modelo: { select: { id: true; nome: true } };
      faccao: { select: { id: true; nome: true } };
      itens: { select: { planejada: true; cortada: true; enviada: true } };
      entregas: { select: { quantidade: true; defeito: true } };
    };
  }>,
  hoje: Date,
) {
  const soma = (k: 'planejada' | 'cortada' | 'enviada') =>
    op.itens.reduce((s, i) => s + (i[k] ?? 0), 0);
  const recebida = op.entregas.reduce((s, e) => s + e.quantidade, 0);
  const defeito = op.entregas.reduce((s, e) => s + e.defeito, 0);
  const enviada = soma('enviada');
  const aberta = op.status === 'NA_FACCAO' || op.status === 'RECEBENDO';
  return {
    id: op.id,
    numero: op.numero,
    status: op.status,
    modelo: op.modelo,
    faccao: op.faccao,
    prazo: op.prazo,
    criadoEm: op.criadoEm,
    planejada: soma('planejada'),
    cortada: soma('cortada'),
    enviada,
    recebida,
    defeito,
    aReceber: aberta ? Math.max(0, enviada - recebida - defeito) : 0,
    atrasada: aberta && op.prazo !== null && op.prazo < hoje,
  };
}

type ResumoOp = ReturnType<typeof resumoDaOp>;

const STATUS_EDITAVEL = 'RASCUNHO';

/**
 * ERP próprio · entrega 4 — ordem de produção.
 *
 * Rascunho → Cortada (tecido sai do estoque) → Na facção (aviamento sai; custo
 * de facção = peças ENVIADAS × preço) → Recebendo (peça pronta entra no
 * estoque, em várias entregas) → Fechada (custo real por peça por grade, que
 * alimenta a calculadora). Toda virada de etapa é CAS no status: duas abas
 * não cortam a mesma OP duas vezes.
 */
@Injectable()
export class OrdensService {
  private readonly logger = new Logger(OrdensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: EstoqueService,
    private readonly fichas: FichasService,
    private readonly sequence: SequenceService,
    // Financeiro (Fase 3): conta a pagar da facção por entrega e o saldo no fechamento.
    @Optional() private readonly fin?: FinanceiroAutomaticoService,
  ) {}

  // ─── Leitura ────────────────────────────────────────────────────────────

  /** Variações (produtos) do modelo, com a grade a que pertencem. */
  private async variacoesDoModelo(empresaId: string, modeloId: string, produtoIds?: string[]) {
    const vs = await this.prisma.catalogoVariacao.findMany({
      where: { empresaId, modeloId, ...(produtoIds ? { produtoId: { in: produtoIds } } : {}) },
      select: {
        produtoId: true,
        modeloLinhaId: true,
        ativo: true,
        modeloCor: {
          select: { ordem: true, corId: true, cor: { select: { nome: true, hex: true } } },
        },
        modeloLinha: { select: { linha: { select: { nome: true, ordem: true } } } },
        modeloTamanho: { select: { tamanho: { select: { nome: true, ordem: true } } } },
      },
    });
    return new Map(vs.map((v) => [v.produtoId, v]));
  }

  private async fichasDasLinhas(empresaId: string, linhaIds: string[]) {
    const fs = await this.prisma.fichaTecnica.findMany({
      where: { empresaId, modeloLinhaId: { in: linhaIds } },
      select: {
        modeloLinhaId: true,
        custoFaccaoPrevisto: true,
        itens: {
          select: {
            insumoId: true,
            consumoPorPeca: true,
            corFixaId: true,
            insumo: {
              select: {
                nome: true,
                cor: true,
                tipo: true,
                unidade: true,
                custoMedio: true,
                cores: {
                  where: { ativo: true },
                  select: {
                    id: true,
                    corId: true,
                    custoMedio: true,
                    cor: { select: { nome: true, hex: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    return new Map(fs.map((f) => [f.modeloLinhaId, f]));
  }

  /** Itens da ficha no formato da conta (só um tipo, se pedir). */
  private itensParaConta(
    fichas: Awaited<ReturnType<OrdensService['fichasDasLinhas']>>,
    tipo?: 'TECIDO' | 'AVIAMENTO',
  ): Map<string, ItemFichaOp[]> {
    return new Map(
      [...fichas].map(([l, f]) => [
        l,
        f.itens
          .filter((i) => !tipo || i.insumo.tipo === tipo)
          .map((i) => ({
            insumoId: i.insumoId,
            consumoPorPeca: Number(i.consumoPorPeca),
            corFixaId: i.corFixaId,
            cores: i.insumo.cores.length
              ? new Map(i.insumo.cores.map((c) => [c.corId, c.id]))
              : null,
          })),
      ]),
    );
  }

  /** Nome, cor e custo de cada necessidade (insumo × cor) pra tela. */
  private descrever(
    fichas: Awaited<ReturnType<OrdensService['fichasDasLinhas']>>,
    nec: Necessidade,
    nomesDasCores: Map<string, { nome: string; hex: string }>,
  ) {
    const ins = [...fichas.values()]
      .flatMap((f) => f.itens)
      .find((i) => i.insumoId === nec.insumoId)?.insumo;
    const daCor = ins?.cores.find((c) => c.id === nec.insumoCorId);
    const cor = daCor?.cor ?? (nec.corId ? nomesDasCores.get(nec.corId) : undefined);
    return {
      nome: ins?.nome ?? '?',
      // Cor da lista quando o insumo tem cores; senão o texto livre de antes.
      cor: cor?.nome ?? ins?.cor ?? null,
      corHex: cor?.hex ?? null,
      tipo: ins?.tipo ?? 'TECIDO',
      unidade: ins?.unidade ?? 'UNIDADE',
      custoUnitario: daCor ? Number(daCor.custoMedio) : Number(ins?.custoMedio ?? 0),
    };
  }

  /** Saldo por insumo E cor (chave `chaveSaldo`). */
  private async saldosInsumos(empresaId: string, ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const g = await this.prisma.insumoMovimento.groupBy({
      by: ['insumoId', 'insumoCorId'],
      where: { empresaId, insumoId: { in: ids } },
      _sum: { quantidade: true },
    });
    return new Map(g.map((x) => [chaveSaldo(x.insumoId, x.insumoCorId), n(x._sum.quantidade)]));
  }

  /** Peças por grade E cor da peça. */
  private pecasPorLinhaECor(
    itens: Array<{ modeloLinhaId: string; corId: string | null; quantidade: number }>,
  ) {
    const m = new Map<string, Map<string | null, number>>();
    for (const i of itens) {
      const porCor = m.get(i.modeloLinhaId) ?? new Map<string | null, number>();
      porCor.set(i.corId, (porCor.get(i.corId) ?? 0) + i.quantidade);
      m.set(i.modeloLinhaId, porCor);
    }
    return m;
  }

  private async nomesDasCores(empresaId: string) {
    const cs = await this.prisma.catalogoCor.findMany({
      where: { empresaId },
      select: { id: true, nome: true, hex: true },
    });
    return new Map(cs.map((c) => [c.id, { nome: c.nome, hex: c.hex }]));
  }

  private async precoFaccao(faccaoId: string | null | undefined, modeloId: string) {
    if (!faccaoId) return null;
    const p = await this.prisma.faccaoPreco.findUnique({
      where: { faccaoId_modeloId: { faccaoId, modeloId } },
      select: { precoPorPeca: true },
    });
    return p ? Number(p.precoPorPeca) : null;
  }

  /**
   * Simulação ANTES de gerar a OP: tecido e aviamentos que a grade pede pela
   * ficha técnica, o que falta no estoque e o custo previsto por peça.
   */
  async simular(user: AuthenticatedUser, dto: SimularOpDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const modelo = await this.prisma.catalogoModelo.findFirst({
      where: { id: dto.modeloId, empresaId },
      select: { id: true, nome: true },
    });
    if (!modelo) throw new NotFoundException('Modelo', dto.modeloId);
    const vs = await this.variacoesDoModelo(
      empresaId,
      modelo.id,
      dto.itens.map((i) => i.produtoId),
    );
    const fora = dto.itens.filter((i) => !vs.has(i.produtoId));
    if (fora.length) throw regra('A grade tem variação que não é deste modelo');

    const pecasPorLinha = new Map<string, number>();
    for (const i of dto.itens) {
      const l = vs.get(i.produtoId)!.modeloLinhaId;
      pecasPorLinha.set(l, (pecasPorLinha.get(l) ?? 0) + i.quantidade);
    }
    const porCor = this.pecasPorLinhaECor(
      dto.itens.map((i) => {
        const v = vs.get(i.produtoId)!;
        return {
          modeloLinhaId: v.modeloLinhaId,
          corId: v.modeloCor.corId,
          quantidade: i.quantidade,
        };
      }),
    );
    const fichas = await this.fichasDasLinhas(empresaId, [...pecasPorLinha.keys()]);
    const precisa = necessidadesDaGrade(porCor, this.itensParaConta(fichas));
    const [saldos, nomes] = await Promise.all([
      this.saldosInsumos(empresaId, [...new Set([...precisa.values()].map((x) => x.insumoId))]),
      this.nomesDasCores(empresaId),
    ]);
    const insumos = [...precisa.values()].map((nec) => {
      const d = this.descrever(fichas, nec, nomes);
      // Cor que o insumo não tem: estoque zero — falta tudo.
      const saldo = nec.semCor ? 0 : (saldos.get(chaveSaldo(nec.insumoId, nec.insumoCorId)) ?? 0);
      return {
        insumoId: nec.insumoId,
        insumoCorId: nec.insumoCorId,
        nome: d.nome,
        cor: d.cor,
        corHex: d.corHex,
        semCor: nec.semCor,
        tipo: d.tipo,
        unidade: d.unidade,
        necessario: nec.quantidade,
        saldo,
        falta: Math.max(0, nec.quantidade - saldo),
        custo: nec.quantidade * d.custoUnitario,
      };
    });
    const pecas = dto.itens.reduce((s, i) => s + i.quantidade, 0);
    const custoInsumos = insumos.reduce((s, i) => s + i.custo, 0);
    const precoFaccao = await this.precoFaccao(dto.faccaoId, modelo.id);
    // Sem facção escolhida (ou sem preço na tabela dela): a facção prevista da ficha.
    const custoFaccao =
      precoFaccao !== null
        ? precoFaccao * pecas
        : [...pecasPorLinha].reduce(
            (s, [l, p]) => s + p * n(fichas.get(l)?.custoFaccaoPrevisto ?? null),
            0,
          );
    return {
      modelo,
      pecas,
      insumos: insumos.sort(
        (a, b) =>
          a.tipo.localeCompare(b.tipo) ||
          a.nome.localeCompare(b.nome) ||
          (a.cor ?? '').localeCompare(b.cor ?? ''),
      ),
      custoInsumos,
      custoFaccao,
      precoFaccaoTabela: precoFaccao,
      custoTotal: custoInsumos + custoFaccao,
      custoPorPeca: pecas ? (custoInsumos + custoFaccao) / pecas : 0,
      gradesSemFicha: [...pecasPorLinha.keys()].filter((l) => !fichas.has(l)).length,
    };
  }

  async listar(user: AuthenticatedUser) {
    const empresaId = await this.erp.empresaLigada(user);
    const ops = await this.prisma.ordemProducao.findMany({
      where: { empresaId },
      orderBy: { criadoEm: 'desc' },
      take: 200,
      include: {
        modelo: { select: { id: true, nome: true } },
        faccao: { select: { id: true, nome: true } },
        itens: { select: { planejada: true, cortada: true, enviada: true } },
        entregas: { select: { quantidade: true, defeito: true } },
      },
    });
    const hoje = new Date();
    return ops.map((op) => resumoDaOp(op, hoje));
  }

  async obter(user: AuthenticatedUser, id: string) {
    const empresaId = await this.erp.empresaLigada(user);
    const op = await this.prisma.ordemProducao.findFirst({
      where: { id, empresaId },
      include: {
        modelo: { select: { id: true, nome: true } },
        faccao: { select: { id: true, nome: true } },
        itens: true,
        entregas: { orderBy: { criadoEm: 'asc' } },
        consumos: {
          orderBy: { criadoEm: 'asc' },
          include: {
            insumo: { select: { nome: true, cor: true, unidade: true, tipo: true } },
            insumoCor: { select: { cor: { select: { nome: true, hex: true } } } },
          },
        },
        custos: { include: { modeloLinha: { select: { linha: { select: { nome: true } } } } } },
      },
    });
    if (!op) throw new NotFoundException('Ordem de produção', id);
    const vs = await this.variacoesDoModelo(
      empresaId,
      op.modeloId,
      op.itens.map((i) => i.produtoId),
    );
    const entreguePor = new Map<string, { recebida: number; defeito: number }>();
    for (const e of op.entregas) {
      const a = entreguePor.get(e.produtoId) ?? { recebida: 0, defeito: 0 };
      a.recebida += e.quantidade;
      a.defeito += e.defeito;
      entreguePor.set(e.produtoId, a);
    }
    const itens = op.itens
      .map((i) => {
        const v = vs.get(i.produtoId);
        const e = entreguePor.get(i.produtoId) ?? { recebida: 0, defeito: 0 };
        return {
          produtoId: i.produtoId,
          modeloLinhaId: i.modeloLinhaId,
          corId: v?.modeloCor.corId ?? null,
          cor: v?.modeloCor.cor ?? { nome: '?', hex: '#999999' },
          corOrdem: v?.modeloCor.ordem ?? 0,
          linha: v?.modeloLinha.linha.nome ?? '?',
          linhaOrdem: v?.modeloLinha.linha.ordem ?? 0,
          tamanho: v?.modeloTamanho.tamanho.nome ?? '?',
          tamanhoOrdem: v?.modeloTamanho.tamanho.ordem ?? 0,
          planejada: i.planejada,
          cortada: i.cortada,
          enviada: i.enviada,
          recebida: e.recebida,
          defeito: e.defeito,
        };
      })
      .sort(
        (a, b) =>
          a.linhaOrdem - b.linhaOrdem || a.corOrdem - b.corOrdem || a.tamanhoOrdem - b.tamanhoOrdem,
      );

    // Sugestões pra próxima etapa, pela ficha técnica.
    const pecasPorLinha = (k: 'planejada' | 'cortada') =>
      this.pecasPorLinhaECor(
        itens.map((i) => ({
          modeloLinhaId: i.modeloLinhaId,
          corId: i.corId,
          quantidade: i[k] ?? 0,
        })),
      );
    const fichas = await this.fichasDasLinhas(empresaId, [
      ...new Set(itens.map((i) => i.modeloLinhaId)),
    ]);
    const nomes = await this.nomesDasCores(empresaId);
    // Sugestão por insumo E cor; cor que o insumo não tem vem marcada (`semCor`).
    const sugestao = (m: Map<string, Necessidade>) =>
      [...m.values()]
        .filter((nec) => nec.quantidade > 0)
        .map((nec) => {
          const d = this.descrever(fichas, nec, nomes);
          return {
            insumoId: nec.insumoId,
            insumoCorId: nec.insumoCorId,
            nome: d.nome,
            cor: d.cor,
            corHex: d.corHex,
            semCor: nec.semCor,
            unidade: d.unidade,
            quantidade: Math.round(nec.quantidade * 1000) / 1000,
          };
        });
    const tecidoReal = op.consumos
      .filter((c) => c.etapa === 'CORTE')
      .reduce((s, c) => s + Number(c.quantidade), 0);
    const cortadas = itens.reduce((s, i) => s + (i.cortada ?? 0), 0);

    return {
      id: op.id,
      numero: op.numero,
      status: op.status,
      modelo: op.modelo,
      faccao: op.faccao,
      prazo: op.prazo,
      observacoes: op.observacoes,
      precoFaccaoPorPeca: op.precoFaccaoPorPeca === null ? null : Number(op.precoFaccaoPorPeca),
      custoTecido: n(op.custoTecido),
      custoAviamentos: n(op.custoAviamentos),
      custoFaccao: n(op.custoFaccao),
      cortadaEm: op.cortadaEm,
      enviadaEm: op.enviadaEm,
      fechadaEm: op.fechadaEm,
      criadoEm: op.criadoEm,
      itens,
      consumos: op.consumos.map((c) => ({
        insumoId: c.insumoId,
        insumoCorId: c.insumoCorId,
        // Cor da lista quando o insumo tem cores (sobrepõe o texto livre).
        insumo: c.insumoCor
          ? { ...c.insumo, cor: c.insumoCor.cor.nome, corHex: c.insumoCor.cor.hex }
          : c.insumo,
        etapa: c.etapa,
        quantidade: Number(c.quantidade),
        custoUnitario: Number(c.custoUnitario),
      })),
      entregas: op.entregas.map((e) => ({
        produtoId: e.produtoId,
        quantidade: e.quantidade,
        defeito: e.defeito,
        criadoEm: e.criadoEm,
      })),
      custos: op.custos.map((c) => ({
        modeloLinhaId: c.modeloLinhaId,
        linha: c.modeloLinha.linha.nome,
        pecas: c.pecas,
        custoTotal: Number(c.custoTotal),
        custoPorPeca: Number(c.custoPorPeca),
      })),
      /** Tecido gasto no corte ÷ peças cortadas — o "consumo médio real" da OP. */
      consumoRealPorPeca: cortadas > 0 && tecidoReal > 0 ? tecidoReal / cortadas : null,
      sugestoes: {
        tecidos: sugestao(
          necessidadesDaGrade(pecasPorLinha('planejada'), this.itensParaConta(fichas, 'TECIDO')),
        ),
        aviamentos: sugestao(
          necessidadesDaGrade(
            // Aviamento acompanha o que foi CORTADO (é o que vai pra facção).
            op.status === 'RASCUNHO' ? pecasPorLinha('planejada') : pecasPorLinha('cortada'),
            this.itensParaConta(fichas, 'AVIAMENTO'),
          ),
        ),
      },
    };
  }

  // ─── Etapas ─────────────────────────────────────────────────────────────

  private async opDaEmpresa(empresaId: string, id: string) {
    const op = await this.prisma.ordemProducao.findFirst({
      where: { id, empresaId },
      select: { id: true, numero: true, status: true, modeloId: true, faccaoId: true },
    });
    if (!op) throw new NotFoundException('Ordem de produção', id);
    return op;
  }

  /** Vira a etapa só se a OP ainda estiver onde a tela achava (CAS). */
  private async virar(
    tx: Tx,
    id: string,
    de: OrdemProducaoStatus[],
    data: Prisma.OrdemProducaoUncheckedUpdateManyInput,
  ) {
    const r = await tx.ordemProducao.updateMany({
      where: { id, status: { in: de } },
      data,
    });
    if (r.count === 0) throw regra('A OP mudou de etapa — recarregue e confira');
  }

  async criar(user: AuthenticatedUser, dto: CriarOpDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const sim = await this.simular(user, dto); // valida modelo e grade
    if (dto.faccaoId) {
      const f = await this.prisma.faccao.findFirst({ where: { id: dto.faccaoId, empresaId } });
      if (!f) throw new NotFoundException('Facção', dto.faccaoId);
    }
    const vs = await this.variacoesDoModelo(
      empresaId,
      dto.modeloId,
      dto.itens.map((i) => i.produtoId),
    );
    const seq = await this.sequence.next(empresaId, 'ordem-producao');
    const op = await this.prisma.ordemProducao.create({
      data: {
        empresaId,
        numero: `OP-${String(seq).padStart(4, '0')}`,
        modeloId: dto.modeloId,
        faccaoId: dto.faccaoId ?? null,
        prazo: dto.prazo ?? null,
        observacoes: dto.observacoes ?? null,
        usuarioId: user.id,
        itens: {
          create: dto.itens.map((i) => ({
            produtoId: i.produtoId,
            modeloLinhaId: vs.get(i.produtoId)!.modeloLinhaId,
            planejada: i.quantidade,
          })),
        },
      },
      select: { id: true, numero: true },
    });
    this.logger.log(`[op] ${op.numero}: ${sim.pecas} peças de ${sim.modelo.nome}`);
    return op;
  }

  /** Rascunho ainda se edita: grade, facção, prazo, observação. */
  async editar(user: AuthenticatedUser, id: string, dto: CriarOpDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const op = await this.opDaEmpresa(empresaId, id);
    if (op.status !== STATUS_EDITAVEL) throw regra('Só OP em rascunho se edita');
    if (dto.modeloId !== op.modeloId) throw regra('O modelo da OP não muda — crie outra');
    await this.simular(user, dto);
    const vs = await this.variacoesDoModelo(
      empresaId,
      op.modeloId,
      dto.itens.map((i) => i.produtoId),
    );
    await this.prisma.$transaction(async (tx) => {
      await this.virar(tx, id, ['RASCUNHO'], {
        faccaoId: dto.faccaoId ?? null,
        prazo: dto.prazo ?? null,
        observacoes: dto.observacoes ?? null,
      });
      await tx.ordemProducaoItem.deleteMany({ where: { opId: id } });
      await tx.ordemProducaoItem.createMany({
        data: dto.itens.map((i) => ({
          opId: id,
          produtoId: i.produtoId,
          modeloLinhaId: vs.get(i.produtoId)!.modeloLinhaId,
          planejada: i.quantidade,
        })),
      });
    });
    return this.obter(user, id);
  }

  /** Baixa insumos na OP: movimento (sai do estoque) + snapshot do custo médio. */
  private async consumir(
    tx: Tx,
    empresaId: string,
    op: { id: string; numero: string },
    etapa: 'CORTE' | 'ENVIO',
    itens: Array<{ insumoId: string; insumoCorId?: string | null; quantidade: number }>,
    usuarioId: string,
  ): Promise<number> {
    if (!itens.length) return 0;
    const ids = [...new Set(itens.map((i) => i.insumoId))];
    const insumos = await tx.insumo.findMany({
      where: { empresaId, id: { in: ids } },
      select: {
        id: true,
        nome: true,
        tipo: true,
        custoMedio: true,
        cores: { select: { id: true, ativo: true, custoMedio: true } },
      },
    });
    if (insumos.length !== ids.length) throw regra('Algum insumo não existe nesta empresa');
    const porId = new Map(insumos.map((i) => [i.id, i]));
    let custo = 0;
    for (const i of itens) {
      const ins = porId.get(i.insumoId)!;
      // Insumo com cores baixa DA COR (e com o custo dela); sem cores, como antes.
      let unit = Number(ins.custoMedio);
      let corId: string | null = null;
      if (ins.cores.length) {
        const c = ins.cores.find((x) => x.id === i.insumoCorId);
        if (!c) throw regra(`${ins.nome}: escolha de qual cor saiu`);
        if (!c.ativo) throw regra(`${ins.nome}: esta cor foi tirada do insumo`);
        unit = Number(c.custoMedio);
        corId = c.id;
      } else if (i.insumoCorId) {
        throw regra(`${ins.nome} não tem cores — lance sem cor`);
      }
      custo += unit * i.quantidade;
      await tx.insumoMovimento.create({
        data: {
          empresaId,
          insumoId: i.insumoId,
          insumoCorId: corId,
          tipo: etapa === 'CORTE' ? 'CONSUMO_CORTE' : 'ENVIO_FACCAO',
          quantidade: D(-i.quantidade, 3),
          documento: op.numero,
          motivo: etapa === 'CORTE' ? 'Corte da OP' : 'Enviado pra facção',
          usuarioId,
        },
      });
      await tx.ordemProducaoConsumo.create({
        data: {
          opId: op.id,
          insumoId: i.insumoId,
          insumoCorId: corId,
          etapa,
          quantidade: D(i.quantidade, 3),
          custoUnitario: D(unit, 4),
        },
      });
    }
    return custo;
  }

  async cortar(user: AuthenticatedUser, id: string, dto: CorteDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const op = await this.opDaEmpresa(empresaId, id);
    const itens = await this.prisma.ordemProducaoItem.findMany({
      where: { opId: id },
      select: { produtoId: true },
    });
    const daOp = new Set(itens.map((i) => i.produtoId));
    if (dto.itens.some((i) => !daOp.has(i.produtoId))) throw regra('Variação que não está na OP');
    if (!dto.itens.some((i) => i.cortada > 0)) throw regra('Nenhuma peça cortada');
    await this.prisma.$transaction(async (tx) => {
      const custo = await this.consumir(tx, empresaId, op, 'CORTE', dto.tecidos, user.id);
      await this.virar(tx, id, ['RASCUNHO'], {
        status: 'CORTADA',
        cortadaEm: new Date(),
        custoTecido: D(custo, 2),
      });
      for (const i of dto.itens) {
        await tx.ordemProducaoItem.updateMany({
          where: { opId: id, produtoId: i.produtoId },
          data: { cortada: i.cortada },
        });
      }
    });
    return this.obter(user, id);
  }

  async enviar(user: AuthenticatedUser, id: string, dto: EnvioDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const op = await this.opDaEmpresa(empresaId, id);
    const f = await this.prisma.faccao.findFirst({ where: { id: dto.faccaoId, empresaId } });
    if (!f) throw new NotFoundException('Facção', dto.faccaoId);
    const preco = dto.precoPorPeca ?? (await this.precoFaccao(dto.faccaoId, op.modeloId));
    if (preco === null) {
      throw regra(`A ${f.nome} não tem preço pra este modelo — informe o preço por peça`);
    }
    const itens = await this.prisma.ordemProducaoItem.findMany({
      where: { opId: id },
      select: { produtoId: true, cortada: true },
    });
    const cortadaPor = new Map(itens.map((i) => [i.produtoId, i.cortada ?? 0]));
    for (const i of dto.itens) {
      if (!cortadaPor.has(i.produtoId)) throw regra('Variação que não está na OP');
      if (i.enviada > (cortadaPor.get(i.produtoId) ?? 0)) {
        throw regra('Não dá pra enviar mais peças do que foram cortadas');
      }
    }
    const enviadas = dto.itens.reduce((s, i) => s + i.enviada, 0);
    if (enviadas === 0) throw regra('Nenhuma peça enviada');
    await this.prisma.$transaction(async (tx) => {
      const custoAv = await this.consumir(tx, empresaId, op, 'ENVIO', dto.aviamentos, user.id);
      await this.virar(tx, id, ['CORTADA'], {
        status: 'NA_FACCAO',
        enviadaEm: new Date(),
        faccaoId: dto.faccaoId,
        precoFaccaoPorPeca: D(preco, 2),
        // A facção cobra por peça ENVIADA (Léo, 06/10).
        custoFaccao: D(preco * enviadas, 2),
        custoAviamentos: D(custoAv, 2),
        ...(dto.prazo !== undefined ? { prazo: dto.prazo } : {}),
      });
      for (const i of dto.itens) {
        await tx.ordemProducaoItem.updateMany({
          where: { opId: id, produtoId: i.produtoId },
          data: { enviada: i.enviada },
        });
      }
    });
    return this.obter(user, id);
  }

  async receber(user: AuthenticatedUser, id: string, dto: RecebimentoDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const op = await this.opDaEmpresa(empresaId, id);
    const comFinanceiro = this.fin ? await this.fin.preparar(empresaId) : false;
    await this.prisma.$transaction(async (tx) => {
      // CAS primeiro: trava a OP nesta etapa enquanto confere os saldos.
      await this.virar(tx, id, ['NA_FACCAO', 'RECEBENDO'], { status: 'RECEBENDO' });
      const [itens, entregas] = await Promise.all([
        tx.ordemProducaoItem.findMany({
          where: { opId: id },
          select: { produtoId: true, enviada: true },
        }),
        tx.ordemProducaoEntrega.groupBy({
          by: ['produtoId'],
          where: { opId: id },
          _sum: { quantidade: true, defeito: true },
        }),
      ]);
      const enviada = new Map(itens.map((i) => [i.produtoId, i.enviada ?? 0]));
      const jaVeio = new Map(
        entregas.map((e) => [e.produtoId, (e._sum.quantidade ?? 0) + (e._sum.defeito ?? 0)]),
      );
      for (const i of dto.itens) {
        if (!enviada.has(i.produtoId)) throw regra('Variação que não está na OP');
        const falta = (enviada.get(i.produtoId) ?? 0) - (jaVeio.get(i.produtoId) ?? 0);
        if (i.quantidade + i.defeito > falta) {
          throw regra(`Chegou mais peça do que foi enviada (faltavam ${falta} desta variação)`);
        }
      }
      const entregaIds: string[] = [];
      for (const i of dto.itens.filter((x) => x.quantidade + x.defeito > 0)) {
        const entrega = await tx.ordemProducaoEntrega.create({
          select: { id: true },
          data: {
            opId: id,
            produtoId: i.produtoId,
            quantidade: i.quantidade,
            defeito: i.defeito,
            usuarioId: user.id,
          },
        });
        entregaIds.push(entrega.id);
        if (i.quantidade > 0) {
          await tx.estoqueMovimento.create({
            data: {
              empresaId,
              produtoId: i.produtoId,
              tipo: 'ENTRADA_PRODUCAO',
              quantidade: i.quantidade,
              documento: op.numero,
              motivo: 'Retorno da facção',
              usuarioId: user.id,
            },
          });
        }
      }
      // Financeiro: esta entrega vira o pagamento proporcional da facção —
      // junto com o recebimento, ou nenhum dos dois.
      if (comFinanceiro && this.fin) await this.fin.entregaFaccaoNaTx(tx, id, entregaIds);
    });
    return this.obter(user, id);
  }

  /**
   * Fechar: custo real = tecido do corte + aviamentos + facção (peças
   * enviadas), rateado por grade e dividido pelas peças RECEBIDAS. Grava o
   * custo de cada grade — é o que a calculadora mostra.
   */
  async fechar(user: AuthenticatedUser, id: string) {
    const empresaId = await this.erp.empresaLigada(user);
    const op = await this.prisma.ordemProducao.findFirst({
      where: { id, empresaId },
      include: { itens: true, entregas: true },
    });
    if (!op) throw new NotFoundException('Ordem de produção', id);
    if (op.status !== 'RECEBENDO') throw regra('Só fecha OP que já recebeu peças da facção');
    const linhas = [...new Set(op.itens.map((i) => i.modeloLinhaId))];
    const previsto = await this.fichas.custosPrevistos(empresaId, linhas);
    const linhaDo = new Map(op.itens.map((i) => [i.produtoId, i.modeloLinhaId]));
    const grades = linhas.map((l) => ({
      modeloLinhaId: l,
      cortadas: op.itens
        .filter((i) => i.modeloLinhaId === l)
        .reduce((s, i) => s + (i.cortada ?? 0), 0),
      recebidas: op.entregas
        .filter((e) => linhaDo.get(e.produtoId) === l)
        .reduce((s, e) => s + e.quantidade, 0),
      previstoPorPeca: previsto.get(l) ?? null,
    }));
    const total = n(op.custoTecido) + n(op.custoAviamentos) + n(op.custoFaccao);
    const custos = ratearCusto(total, grades);
    const comFinanceiro = this.fin ? await this.fin.preparar(empresaId) : false;
    await this.prisma.$transaction(async (tx) => {
      await this.virar(tx, id, ['RECEBENDO'], { status: 'FECHADA', fechadaEm: new Date() });
      // Financeiro: peças enviadas que não voltaram = saldo da facção.
      if (comFinanceiro && this.fin) await this.fin.saldoFaccaoNaTx(tx, id);
      if (custos.length) {
        await tx.ordemProducaoCusto.createMany({
          data: custos.map((c) => ({
            opId: id,
            modeloLinhaId: c.modeloLinhaId,
            pecas: c.pecas,
            custoTotal: D(c.custoTotal, 2),
            custoPorPeca: D(c.custoPorPeca, 4),
          })),
        });
      }
    });
    this.logger.log(`[op] ${op.numero} fechada — R$ ${total.toFixed(2)}`);
    return this.obter(user, id);
  }

  /** Cancela antes de ir pra facção. O tecido já cortado continua baixado. */
  async cancelar(user: AuthenticatedUser, id: string) {
    const empresaId = await this.erp.empresaLigada(user);
    await this.opDaEmpresa(empresaId, id);
    await this.prisma.$transaction((tx) =>
      this.virar(tx, id, ['RASCUNHO', 'CORTADA'], { status: 'CANCELADA' }),
    );
    return this.obter(user, id);
  }

  // ─── Situação por facção e custo pra calculadora ────────────────────────

  async situacaoFaccoes(user: AuthenticatedUser) {
    const empresaId = await this.erp.empresaLigada(user);
    const ops = await this.prisma.ordemProducao.findMany({
      where: { empresaId, status: { in: ['NA_FACCAO', 'RECEBENDO'] }, faccaoId: { not: null } },
      include: {
        modelo: { select: { id: true, nome: true } },
        faccao: { select: { id: true, nome: true } },
        itens: { select: { planejada: true, cortada: true, enviada: true } },
        entregas: { select: { quantidade: true, defeito: true } },
        consumos: {
          where: { etapa: 'ENVIO' },
          select: {
            quantidade: true,
            insumo: { select: { id: true, nome: true, unidade: true } },
            insumoCor: { select: { id: true, cor: { select: { nome: true } } } },
          },
        },
      },
      orderBy: { prazo: 'asc' },
    });
    const hoje = new Date();
    type Grupo = {
      faccao: { id: string; nome: string };
      ops: ResumoOp[];
      aviamentos: Map<string, { nome: string; unidade: string; quantidade: number }>;
    };
    const porFaccao = new Map<string, Grupo>();
    for (const op of ops) {
      const g: Grupo = porFaccao.get(op.faccaoId!) ?? {
        faccao: op.faccao!,
        ops: [],
        aviamentos: new Map(),
      };
      g.ops.push(resumoDaOp(op, hoje));
      for (const c of op.consumos) {
        const k = chaveSaldo(c.insumo.id, c.insumoCor?.id);
        const a = g.aviamentos.get(k) ?? {
          nome: c.insumoCor ? `${c.insumo.nome} ${c.insumoCor.cor.nome}` : c.insumo.nome,
          unidade: c.insumo.unidade,
          quantidade: 0,
        };
        a.quantidade += Number(c.quantidade);
        g.aviamentos.set(k, a);
      }
      porFaccao.set(op.faccaoId!, g);
    }
    return [...porFaccao.values()].map((g) => ({
      faccao: g.faccao,
      aReceber: g.ops.reduce((s, o) => s + o.aReceber, 0),
      atrasadas: g.ops.filter((o) => o.atrasada).length,
      ops: g.ops,
      aviamentosEmPoder: [...g.aviamentos.values()],
    }));
  }

  /**
   * Custo REAL por grade pra calculadora: média ponderada das OPs fechadas e
   * a última OP (com número e data — a origem fica visível).
   */
  async custosReais(empresaId: string, modeloLinhaIds: string[]) {
    if (!modeloLinhaIds.length) return new Map();
    const cs = await this.prisma.ordemProducaoCusto.findMany({
      where: { modeloLinhaId: { in: modeloLinhaIds }, op: { empresaId, status: 'FECHADA' } },
      orderBy: { criadoEm: 'desc' },
      select: {
        modeloLinhaId: true,
        pecas: true,
        custoTotal: true,
        custoPorPeca: true,
        criadoEm: true,
        op: { select: { numero: true, fechadaEm: true } },
      },
    });
    const out = new Map<
      string,
      { media: number; pecas: number; ultima: { valor: number; numero: string; em: Date | null } }
    >();
    for (const l of modeloLinhaIds) {
      const daLinha = cs.filter((c) => c.modeloLinhaId === l);
      if (!daLinha.length) continue;
      const pecas = daLinha.reduce((s, c) => s + c.pecas, 0);
      const total = daLinha.reduce((s, c) => s + Number(c.custoTotal), 0);
      const u = daLinha[0];
      out.set(l, {
        media: pecas ? total / pecas : 0,
        pecas,
        ultima: { valor: Number(u.custoPorPeca), numero: u.op.numero, em: u.op.fechadaEm },
      });
    }
    return out;
  }
}
