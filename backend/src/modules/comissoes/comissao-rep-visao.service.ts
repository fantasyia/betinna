import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  faseDaComissao,
  rotuloDaFase,
  vencimentoDia5 as vencimento05,
  type FaseComissao,
} from './fase-comissao.util';

/** Status de pedido que já conta comissão (o mesmo do fechamento do mês). */
const STATUS_COMISSIONAVEL = [
  'ENVIADO_ERP',
  'PAGO',
  'EM_SEPARACAO',
  'ENVIADO',
  'ENTREGUE',
] as const;

export interface LinhaPedidoComissao {
  pedidoId: string;
  numero: string;
  cliente: string;
  data: string | null;
  totalPedido: number;
  comissao: number;
}

export interface PrevisaoDoMes {
  mes: number;
  ano: number;
  /** Faturamento atribuído ao rep no mês, já líquido de devolução aprovada. */
  base: number;
  valor: number;
  qtdPedidos: number;
  /** Dia 05 do mês seguinte — a data em que essa comissão vence. */
  previsaoPagamentoEm: string;
  /** True quando o mês já foi fechado: aí não é mais previsão, é folha. */
  fechado: boolean;
  pedidos: LinhaPedidoComissao[];
}

/**
 * Uma linha de comissão como o rep vê: quanto, de qual venda, e EM QUE PÉ.
 *
 * Serve pros dois tipos — venda (uma por pedido) e locação (uma por mês de
 * contrato) — porque a pergunta é a mesma e a tela é a mesma.
 */
export interface LinhaComFase {
  id: string;
  /** `VENDA` (pedido) ou `LOCACAO` (contrato × mês). */
  tipo: 'VENDA' | 'LOCACAO';
  /** Número do pedido, ou o do contrato + a competência. */
  referencia: string;
  cliente: string;
  /** Mês de competência (`YYYY-MM`). */
  competencia: string;
  base: number;
  percentual: number;
  valor: number;
  fase: FaseComissao;
  faseRotulo: string;
  /** Dia 05 do mês seguinte à competência. */
  previsaoPagamentoEm: string;
  pagoEm: string | null;
}

export interface ExtratoPorFase {
  /** Soma por fase — o topo da tela, respondendo "quanto e quando". */
  totais: Record<FaseComissao, number>;
  linhas: LinhaComFase[];
}

export interface Recebimento {
  id: string;
  mes: number;
  ano: number;
  tipo: string;
  totalVendas: number;
  totalComissao: number;
  qtdPedidos: number;
  pagoEm: string | null;
  previsaoPagamentoEm: string;
}

/**
 * A comissão pelos olhos do REPRESENTANTE.
 *
 * O que ele precisa saber, nesta ordem: **quanto vou receber, e quando**. A tela
 * antiga só mostrava a folha já fechada — ou seja, no dia 3 do mês o rep não via
 * nada do que vendeu, e o número aparecia do nada depois do fechamento.
 *
 * Por isso duas coisas nascem aqui:
 *  - **previsão do mês corrente**, calculada dos pedidos já atribuídos a ele
 *    (mesma regra do fechamento, pra não haver dois números diferentes);
 *  - **detalhe por pedido**, porque comissão que não dá pra conferir vira
 *    discussão no fim do mês — e quem confere é ele, não a gestão.
 *
 * A data de pagamento é sempre **dia 05 do mês seguinte** ao da competência (a
 * mesma regra que o provisionamento usa no ERP). Um número só, dos dois lados.
 */
@Injectable()
export class ComissaoRepVisaoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Previsão do mês (default: o corrente).
   *
   * Quando o mês já foi fechado, devolve os números DA FOLHA em vez de recalcular
   * — a folha é snapshot da % vigente no fechamento, e recalcular mostraria outro
   * valor se a % do rep mudar depois.
   */
  async previsao(
    user: AuthenticatedUser,
    empresaId: string,
    mes?: number,
    ano?: number,
  ): Promise<PrevisaoDoMes> {
    const agora = new Date();
    const m = mes ?? agora.getUTCMonth() + 1;
    const a = ano ?? agora.getUTCFullYear();

    const fechada = await this.prisma.comissao.findFirst({
      where: { empresaId, representanteId: user.id, tipo: 'REP', mes: m, ano: a },
      select: { totalVendas: true, totalComissao: true, qtdPedidos: true },
    });

    const pedidos = await this.prisma.pedido.findMany({
      where: {
        empresaId,
        representanteId: user.id,
        status: { in: STATUS_COMISSIONAVEL as unknown as never },
        enviadoErpEm: { gte: this.inicioBrt(a, m), lt: this.inicioBrt(a, m + 1) },
      },
      select: {
        id: true,
        numero: true,
        total: true,
        frete: true,
        valorDevolvido: true,
        comissao: true,
        comissaoEstornada: true,
        enviadoErpEm: true,
        cliente: { select: { nome: true } },
      },
      orderBy: { enviadoErpEm: 'asc' },
    });

    const linhas: LinhaPedidoComissao[] = pedidos.map((p) => ({
      pedidoId: p.id,
      numero: p.numero,
      cliente: p.cliente?.nome ?? '—',
      data: p.enviadoErpEm ? p.enviadoErpEm.toISOString() : null,
      totalPedido: Math.max(
        0,
        Number(p.total) - Number(p.frete ?? 0) - Number(p.valorDevolvido ?? 0),
      ),
      // Líquido: devolução aprovada já estornou parte da comissão.
      comissao: Math.max(0, Number(p.comissao) - Number(p.comissaoEstornada ?? 0)),
    }));

    return {
      mes: m,
      ano: a,
      base: fechada ? Number(fechada.totalVendas) : linhas.reduce((s, l) => s + l.totalPedido, 0),
      valor: fechada
        ? Number(fechada.totalComissao)
        : Math.round(linhas.reduce((s, l) => s + l.comissao, 0) * 100) / 100,
      qtdPedidos: fechada ? fechada.qtdPedidos : linhas.length,
      previsaoPagamentoEm: this.vencimentoDia5(m, a),
      fechado: Boolean(fechada),
      pedidos: linhas,
    };
  }

  /**
   * O que já caiu — com filtro de período.
   *
   * O filtro é pela DATA DO PAGAMENTO, não pela competência: quem procura
   * "recebi quanto em julho?" está olhando o extrato, não o mês da venda.
   */
  async recebidas(
    user: AuthenticatedUser,
    empresaId: string,
    de?: string,
    ate?: string,
  ): Promise<{ total: number; itens: Recebimento[] }> {
    const registros = await this.prisma.comissao.findMany({
      where: {
        empresaId,
        representanteId: user.id,
        pago: true,
        ...(de || ate
          ? {
              pagoEm: {
                ...(de ? { gte: new Date(`${de}T00:00:00.000Z`) } : {}),
                // Fim do dia: `ate` como 00:00 cortaria o próprio dia escolhido.
                ...(ate ? { lte: new Date(`${ate}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ pagoEm: 'desc' }, { ano: 'desc' }, { mes: 'desc' }],
      select: {
        id: true,
        mes: true,
        ano: true,
        tipo: true,
        totalVendas: true,
        totalComissao: true,
        qtdPedidos: true,
        pagoEm: true,
      },
    });

    const itens: Recebimento[] = registros.map((c) => ({
      id: c.id,
      mes: c.mes,
      ano: c.ano,
      tipo: c.tipo,
      totalVendas: Number(c.totalVendas),
      totalComissao: Number(c.totalComissao),
      qtdPedidos: c.qtdPedidos,
      pagoEm: c.pagoEm ? c.pagoEm.toISOString() : null,
      previsaoPagamentoEm: this.vencimentoDia5(c.mes, c.ano),
    }));
    return {
      total: Math.round(itens.reduce((s, i) => s + i.totalComissao, 0) * 100) / 100,
      itens,
    };
  }

  /**
   * O extrato do rep POR FASE — venda e locação na mesma lista.
   *
   * Existe porque "quanto vou receber" não é uma pergunta só: o rep quer saber
   * o que ainda depende da expedição, o que já virou conta a pagar no ERP, o
   * que o financeiro já baixou e o que caiu por cancelamento. Antes, tudo isso
   * era um número só no fim do mês — e qualquer divergência virava discussão
   * sem como conferir.
   *
   * As fases são derivadas da própria linha (`faseDaComissao`), não de um campo
   * `status` paralelo: campo paralelo é como a tela e o ERP passam a discordar.
   */
  async extrato(user: AuthenticatedUser, empresaId: string): Promise<ExtratoPorFase> {
    const [vendas, locacoes] = await Promise.all([
      this.prisma.pedidoComissao.findMany({
        where: { empresaId, usuarioId: user.id },
        select: {
          id: true,
          tipo: true,
          percentual: true,
          base: true,
          valor: true,
          contaPagarErpId: true,
          pagoEm: true,
          criadoEm: true,
          pedido: {
            select: {
              numero: true,
              status: true,
              enviadoErpEm: true,
              criadoEm: true,
              cliente: { select: { nome: true } },
            },
          },
        },
        orderBy: { criadoEm: 'desc' },
      }),
      this.prisma.contratoComissao.findMany({
        where: { empresaId, usuarioId: user.id },
        select: {
          id: true,
          competencia: true,
          percentual: true,
          base: true,
          valor: true,
          mensalidadeRecebidaEm: true,
          contaPagarErpId: true,
          pagoEm: true,
          contrato: {
            select: {
              id: true,
              status: true,
              cliente: { select: { nome: true } },
              proposta: { select: { numero: true } },
            },
          },
        },
        orderBy: { competencia: 'desc' },
      }),
    ]);

    const linhas: LinhaComFase[] = [];

    for (const v of vendas) {
      // Competência da venda = mês do faturamento (mesma régua da folha e da
      // conta a pagar). Sem `enviadoErpEm` ainda, cai na criação da linha.
      const ref = v.pedido?.enviadoErpEm ?? v.pedido?.criadoEm ?? v.criadoEm;
      const fase = faseDaComissao({
        valor: Number(v.valor),
        contaPagarErpId: v.contaPagarErpId,
        pagoEm: v.pagoEm,
        origemCancelada: v.pedido?.status === 'CANCELADO',
      });
      const venc = vencimento05(ref.getUTCMonth() + 1, ref.getUTCFullYear());
      linhas.push({
        id: v.id,
        tipo: 'VENDA',
        referencia: v.pedido?.numero ?? '—',
        cliente: v.pedido?.cliente?.nome ?? '—',
        competencia: ref.toISOString().slice(0, 7),
        base: Number(v.base),
        percentual: v.percentual,
        valor: Number(v.valor),
        fase,
        faseRotulo: rotuloDaFase(fase, venc),
        previsaoPagamentoEm: venc,
        pagoEm: v.pagoEm ? v.pagoEm.toISOString() : null,
      });
    }

    for (const c of locacoes) {
      const fase = faseDaComissao({
        valor: Number(c.valor),
        contaPagarErpId: c.contaPagarErpId,
        pagoEm: c.pagoEm,
        mensalidadeRecebidaEm: c.mensalidadeRecebidaEm,
        origemCancelada: c.contrato?.status === 'CANCELADO',
      });
      const venc = vencimento05(c.competencia.getUTCMonth() + 1, c.competencia.getUTCFullYear());
      const mes = c.competencia.toISOString().slice(0, 7);
      linhas.push({
        id: c.id,
        tipo: 'LOCACAO',
        referencia: `${c.contrato?.proposta?.numero ?? 'Contrato'} · ${mes}`,
        cliente: c.contrato?.cliente?.nome ?? '—',
        competencia: mes,
        base: Number(c.base),
        percentual: c.percentual,
        valor: Number(c.valor),
        fase,
        faseRotulo: rotuloDaFase(fase, venc),
        previsaoPagamentoEm: venc,
        pagoEm: c.pagoEm ? c.pagoEm.toISOString() : null,
      });
    }

    linhas.sort((a, b) => b.competencia.localeCompare(a.competencia));

    const totais: Record<FaseComissao, number> = {
      AGUARDANDO_ENVIO: 0,
      AGUARDANDO_MENSALIDADE: 0,
      A_PAGAR: 0,
      PAGA: 0,
      CANCELADA: 0,
    };
    for (const l of linhas) totais[l.fase] += l.valor;
    for (const k of Object.keys(totais) as FaseComissao[]) {
      totais[k] = Math.round(totais[k] * 100) / 100;
    }

    return { totais, linhas };
  }

  /** Dia 05 do mês SEGUINTE — a mesma regra do provisionamento no ERP. */
  private vencimentoDia5(mes: number, ano: number): string {
    return vencimento05(mes, ano);
  }

  /** Começo do mês em horário de Brasília (o fechamento usa a mesma janela). */
  private inicioBrt(ano: number, mes: number): Date {
    const OFFSET_BRT_H = 3;
    return new Date(Date.UTC(ano, mes - 1, 1, OFFSET_BRT_H));
  }
}
