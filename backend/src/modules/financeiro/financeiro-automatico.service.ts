import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type FinTipo } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { FinanceiroService } from './financeiro.service';
import { hojePuro } from './financeiro.regras';

type Tx = Prisma.TransactionClient;
const D = (v: number) => new Prisma.Decimal(v.toFixed(2));
const isoDe = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Divide um valor em N parcelas em centavos: a sobra da divisão vai nas
 * PRIMEIRAS (R$ 100 em 3 = 33,34 + 33,33 + 33,33). A soma bate exato. PURO.
 */
export function dividirEmParcelas(valor: number, n: number): number[] {
  const totalC = Math.round(valor * 100);
  const base = Math.floor(totalC / n);
  const sobra = totalC - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < sobra ? 1 : 0)) / 100);
}

/** Mesma data, `meses` depois (dia 31 → último dia do mês). Data pura, 12:00 UTC. */
export function somarMeses(d: Date, meses: number): Date {
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1, 12));
  const ultimo = new Date(
    Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  alvo.setUTCDate(Math.min(d.getUTCDate(), ultimo));
  return alvo;
}

/**
 * Lançamentos AUTOMÁTICOS do financeiro (ERP Fase 3 · entrega B):
 *  - pedido da vitrine → conta a RECEBER; "pagamento recebido" dá baixa;
 *    pedido cancelado cancela o título (reativado, reabre);
 *  - entrega da facção → conta a PAGAR proporcional (peças devolvidas ×
 *    preço), vencendo na entrega; fechamento da OP → o SALDO das peças
 *    enviadas que não voltaram (a facção cobra por peça enviada);
 *  - compra de insumo → conta a PAGAR pro fornecedor.
 *
 * Só onde `financeiro.ativo`. Cada evento tem chave única no FinTitulo
 * (pedidoId+parcela, opEntregaId, opSaldoId, insumoMovimentoId), então
 * repetir a chamada não duplica nada.
 *
 * Os `...NaTx` rodam DENTRO da transação de quem chamou (recebimento da OP,
 * compra de insumo, pagamento recebido): o título nasce junto com o evento
 * ou nenhum dos dois. Antes da transação, quem chama faz `preparar()` (flag
 * + categorias/contas padrão, fora da tx).
 */
@Injectable()
export class FinanceiroAutomaticoService {
  private readonly logger = new Logger(FinanceiroAutomaticoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fin: FinanceiroService,
  ) {}

  /** true = financeiro ligado e com os padrões criados. false = não faz nada. */
  async preparar(empresaId: string): Promise<boolean> {
    if (!(await this.fin.ativoNaEmpresa(empresaId))) return false;
    await this.fin.garantirPadroes(empresaId);
    return true;
  }

  private async categoria(tx: Tx, empresaId: string, tipo: FinTipo, nome: string) {
    const c = await tx.finCategoria.findUnique({
      where: { empresaId_tipo_nome: { empresaId, tipo, nome } },
      select: { id: true },
    });
    return c?.id ?? null;
  }

  /**
   * Onde o dinheiro caiu: a conta com esse nome ("Banco" no Pix manual,
   * "Asaas" no pagamento online); sem ela, a 1ª conta ativa.
   */
  private async contaDoPix(tx: Tx, empresaId: string, nome = 'Banco') {
    const banco = await tx.finConta.findFirst({
      where: { empresaId, ativo: true, nome },
      select: { id: true },
    });
    if (banco) return banco.id;
    const outra = await tx.finConta.findFirst({
      where: { empresaId, ativo: true },
      orderBy: { criadoEm: 'asc' },
      select: { id: true },
    });
    return outra?.id ?? null;
  }

  // ─── Pedido da vitrine → a receber ───────────────────────────────────────

  /**
   * Garante o título a receber do pedido da vitrine (1 por pedido, parcela 1).
   * Pedido com total 0 (tudo sob consulta) não gera título: o valor nasce
   * quando alguém precificar o pedido. Devolve o título (ou null).
   */
  async tituloDoPedidoNaTx(tx: Tx, pedidoId: string) {
    const p = await tx.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        id: true,
        empresaId: true,
        numero: true,
        origem: true,
        status: true,
        total: true,
        clienteId: true,
        contatoNome: true,
        criadoEm: true,
        cliente: { select: { nome: true } },
      },
    });
    if (!p || p.origem !== 'VITRINE') return null;
    const total = Number(p.total);
    const existente = await tx.finTitulo.findUnique({
      where: { pedidoId_parcela: { pedidoId, parcela: 1 } },
      include: { baixas: { where: { estornadaEm: null }, select: { id: true } } },
    });
    if (existente) {
      // Pedido re-precificado (item sob consulta ganhou preço) e nada recebido
      // ainda: o título acompanha o total do pedido.
      const { baixas, ...titulo } = existente;
      if (
        titulo.status === 'ABERTO' &&
        (titulo.totalParcelas ?? 1) === 1 &&
        baixas.length === 0 &&
        total > 0 &&
        Math.abs(Number(titulo.valor) - total) > 0.004
      ) {
        return tx.finTitulo.update({ where: { id: titulo.id }, data: { valor: D(total) } });
      }
      return titulo;
    }
    if (!(total > 0) || p.status === 'CANCELADO') return null;
    return tx.finTitulo.create({
      data: {
        empresaId: p.empresaId,
        tipo: 'RECEBER',
        descricao: `Pedido ${p.numero} (vitrine)`,
        valor: D(total),
        // Pix à vista: vence no dia do pedido.
        vencimento: hojePuro(p.criadoEm),
        categoriaId: await this.categoria(tx, p.empresaId, 'RECEBER', 'Venda atacado'),
        contatoNome: p.contatoNome ?? p.cliente?.nome ?? null,
        clienteId: p.clienteId,
        pedidoId,
        parcela: 1,
        totalParcelas: 1,
      },
    });
  }

  /** Pedido da vitrine criado (fora de tx, MELHOR ESFORÇO: nunca derruba o pedido). */
  async aoCriarPedidoVitrine(empresaId: string, pedidoId: string): Promise<void> {
    try {
      if (!(await this.preparar(empresaId))) return;
      await this.prisma.$transaction((tx) => this.tituloDoPedidoNaTx(tx, pedidoId));
    } catch (err) {
      this.logger.error(`[financeiro] título do pedido ${pedidoId} não foi criado: ${String(err)}`);
    }
  }

  /**
   * "Pagamento recebido" (Pix manual): baixa o que falta do título do pedido
   * na conta Banco, forma Pix. Cria o título antes, se ainda não existe.
   */
  async pagamentoRecebidoNaTx(
    tx: Tx,
    empresaId: string,
    pedidoId: string,
    usuarioId: string | null,
    opts: { conta?: string; forma?: 'PIX' | 'CARTAO'; observacao?: string } = {},
  ) {
    const t = await this.tituloDoPedidoNaTx(tx, pedidoId);
    if (!t || t.status === 'CANCELADO' || t.status === 'QUITADO') return;
    const pago = await tx.finBaixa.aggregate({
      where: { tituloId: t.id, estornadaEm: null },
      _sum: { valor: true },
    });
    const falta = Number(t.valor) - Number(pago._sum.valor ?? 0);
    if (falta <= 0.004) return;
    const contaId = await this.contaDoPix(tx, empresaId, opts.conta);
    if (!contaId) {
      this.logger.warn(
        `[financeiro] pedido ${pedidoId} pago, mas a empresa não tem conta ativa pra baixa`,
      );
      return;
    }
    await this.fin.baixarNaTx(
      tx,
      t.id,
      {
        valor: Math.round(falta * 100) / 100,
        data: isoDe(hojePuro()),
        contaId,
        forma: opts.forma ?? 'PIX',
        observacao: opts.observacao ?? 'Pagamento recebido no pedido',
      },
      usuarioId,
    );
  }

  // ─── Pagamento online (Asaas) ────────────────────────────────────────────

  /**
   * Pedido PAGO no Asaas: o título a receber passa a refletir QUANDO o
   * dinheiro cai. Cartão parcelado em N vezes → N títulos (parcela 1..N), um
   * por mês a partir do 1º crédito previsto, somando o valor do pedido (a taxa
   * do parcelado é do cliente, Léo 07/10). À vista (Pix, cartão 1x) → o mesmo
   * título, vencendo no crédito previsto. Título que já recebeu algo não é
   * mexido. Repetir não duplica (chave pedidoId+parcela).
   */
  async parcelarPedidoNaTx(
    tx: Tx,
    pedidoId: string,
    parcelas: number,
    primeiroCredito: Date,
    rotulo: string,
  ) {
    const t = await this.tituloDoPedidoNaTx(tx, pedidoId);
    if (!t || t.status === 'CANCELADO') return;
    const recebeu = await tx.finBaixa.count({ where: { tituloId: t.id, estornadaEm: null } });
    if (recebeu > 0) return;
    const n = Math.max(1, Math.trunc(parcelas));
    if ((t.totalParcelas ?? 1) === n && n > 1) return; // já dividido
    const valores = dividirEmParcelas(Number(t.valor), n);
    // "Pedido PED-0007 (vitrine)" + " · 1/3 cartão" — sem empilhar rótulo ao repetir.
    const base = t.descricao.replace(/ · .*$/, '');
    await tx.finTitulo.update({
      where: { id: t.id },
      data: {
        valor: D(valores[0]),
        vencimento: primeiroCredito,
        totalParcelas: n,
        descricao: n > 1 ? `${base} · 1/${n} ${rotulo}` : `${base} · ${rotulo}`,
      },
    });
    for (let k = 2; k <= n; k++) {
      await tx.finTitulo.upsert({
        where: { pedidoId_parcela: { pedidoId, parcela: k } },
        create: {
          empresaId: t.empresaId,
          tipo: 'RECEBER',
          descricao: `${base} · ${k}/${n} ${rotulo}`,
          valor: D(valores[k - 1]),
          vencimento: somarMeses(primeiroCredito, k - 1),
          categoriaId: t.categoriaId,
          contatoNome: t.contatoNome,
          clienteId: t.clienteId,
          pedidoId,
          parcela: k,
          totalParcelas: n,
        },
        update: {},
      });
    }
  }

  /**
   * Uma parcela do Asaas: o aviso de CONFIRMADO traz a data prevista do
   * crédito (ajusta o vencimento); o de RECEBIDO dá a baixa na conta Asaas.
   * Parcela já quitada ou cancelada: nada (aviso repetido).
   */
  async parcelaAsaasNaTx(
    tx: Tx,
    empresaId: string,
    pedidoId: string,
    parcela: number,
    opts: {
      credito?: Date | null;
      recebido: boolean;
      forma: 'PIX' | 'CARTAO';
      observacao: string;
    },
  ) {
    const t = await tx.finTitulo.findUnique({
      where: { pedidoId_parcela: { pedidoId, parcela } },
      include: { baixas: { where: { estornadaEm: null }, select: { valor: true } } },
    });
    if (!t || t.status === 'CANCELADO') return;
    const pagoC = t.baixas.reduce((s, b) => s + Math.round(Number(b.valor) * 100), 0);
    const faltaC = Math.round(Number(t.valor) * 100) - pagoC;
    if (opts.credito && pagoC === 0) {
      await tx.finTitulo.update({ where: { id: t.id }, data: { vencimento: opts.credito } });
    }
    if (!opts.recebido || faltaC <= 0) return;
    const contaId = await this.contaDoPix(tx, empresaId, 'Asaas');
    if (!contaId) {
      this.logger.warn(`[financeiro] pedido ${pedidoId}: recebido no Asaas, mas sem conta ativa`);
      return;
    }
    await this.fin.baixarNaTx(
      tx,
      t.id,
      {
        valor: faltaC / 100,
        data: isoDe(hojePuro()),
        contaId,
        forma: opts.forma,
        observacao: opts.observacao,
      },
      null,
    );
  }

  /**
   * Pedido cancelado → títulos cancelados (todas as parcelas). Parcela que já
   * recebeu NÃO cancela (devolução é decisão de gente): fica no log.
   */
  async aoCancelarPedido(pedidoId: string): Promise<void> {
    try {
      const ts = await this.prisma.finTitulo.findMany({
        where: { pedidoId, tipo: 'RECEBER' },
        select: {
          id: true,
          status: true,
          baixas: { where: { estornadaEm: null }, select: { id: true } },
        },
      });
      for (const t of ts) {
        if (t.status === 'CANCELADO') continue;
        if (t.baixas.length > 0) {
          this.logger.warn(
            `[financeiro] pedido ${pedidoId} cancelado com recebimento no título ${t.id} — confira a devolução`,
          );
          continue;
        }
        await this.prisma.finTitulo.update({ where: { id: t.id }, data: { status: 'CANCELADO' } });
      }
    } catch (err) {
      this.logger.error(
        `[financeiro] título do pedido ${pedidoId} não foi cancelado: ${String(err)}`,
      );
    }
  }

  /** Pedido reativado (voltou a RASCUNHO): o título cancelado reabre. */
  async aoReativarPedidoNaTx(tx: Tx, pedidoId: string) {
    const ts = await tx.finTitulo.findMany({
      where: { pedidoId, tipo: 'RECEBER' },
      select: { id: true, status: true },
    });
    if (!ts.length) {
      await this.tituloDoPedidoNaTx(tx, pedidoId);
      return;
    }
    for (const t of ts) {
      if (t.status !== 'CANCELADO') continue;
      await tx.finTitulo.update({ where: { id: t.id }, data: { status: 'ABERTO' } });
      await this.fin.reaplicarStatus(tx, t.id);
    }
  }

  // ─── Facção → a pagar ────────────────────────────────────────────────────

  private async opComFaccao(tx: Tx, opId: string) {
    return tx.ordemProducao.findUnique({
      where: { id: opId },
      select: {
        id: true,
        empresaId: true,
        numero: true,
        faccaoId: true,
        precoFaccaoPorPeca: true,
        faccao: { select: { nome: true } },
      },
    });
  }

  /**
   * Uma ENTREGA da facção (um recebimento, que grava uma linha por variação)
   * → um título: peças devolvidas (boas + com defeito: a facção cobra por
   * peça enviada) × preço da facção, vencendo na entrega. Chave = a 1ª linha.
   */
  async entregaFaccaoNaTx(tx: Tx, opId: string, entregaIds: string[]) {
    if (!entregaIds.length) return null;
    const chave = [...entregaIds].sort()[0];
    const ja = await tx.finTitulo.findUnique({ where: { opEntregaId: chave } });
    if (ja) return ja;
    const op = await this.opComFaccao(tx, opId);
    const preco = Number(op?.precoFaccaoPorPeca ?? 0);
    if (!op || !(preco > 0)) return null;
    const entregas = await tx.ordemProducaoEntrega.findMany({
      where: { id: { in: entregaIds }, opId },
      select: { quantidade: true, defeito: true },
    });
    const pecas = entregas.reduce((s, e) => s + e.quantidade + e.defeito, 0);
    if (pecas <= 0) return null;
    const nome = op.faccao?.nome ?? 'Facção';
    return tx.finTitulo.create({
      data: {
        empresaId: op.empresaId,
        tipo: 'PAGAR',
        descricao: `${nome} · ${op.numero} · entrega de ${pecas} peça(s)`,
        valor: D(pecas * preco),
        vencimento: hojePuro(),
        categoriaId: await this.categoria(tx, op.empresaId, 'PAGAR', 'Facção'),
        contatoNome: nome,
        faccaoId: op.faccaoId,
        opEntregaId: chave,
      },
    });
  }

  /**
   * Fechamento da OP → o SALDO da facção: peças enviadas que não voltaram ×
   * preço. Somado às entregas, fecha com o custo da facção da OP.
   */
  async saldoFaccaoNaTx(tx: Tx, opId: string) {
    const ja = await tx.finTitulo.findUnique({ where: { opSaldoId: opId } });
    if (ja) return ja;
    const op = await this.opComFaccao(tx, opId);
    const preco = Number(op?.precoFaccaoPorPeca ?? 0);
    if (!op || !(preco > 0)) return null;
    const [itens, entregas] = await Promise.all([
      tx.ordemProducaoItem.aggregate({ where: { opId }, _sum: { enviada: true } }),
      tx.ordemProducaoEntrega.aggregate({
        where: { opId },
        _sum: { quantidade: true, defeito: true },
      }),
    ]);
    const enviadas = itens._sum.enviada ?? 0;
    const voltaram = (entregas._sum.quantidade ?? 0) + (entregas._sum.defeito ?? 0);
    const faltam = enviadas - voltaram;
    if (faltam <= 0) return null;
    const nome = op.faccao?.nome ?? 'Facção';
    return tx.finTitulo.create({
      data: {
        empresaId: op.empresaId,
        tipo: 'PAGAR',
        descricao: `${nome} · ${op.numero} · saldo de ${faltam} peça(s) enviada(s) que não voltaram`,
        valor: D(faltam * preco),
        vencimento: hojePuro(),
        categoriaId: await this.categoria(tx, op.empresaId, 'PAGAR', 'Facção'),
        contatoNome: nome,
        faccaoId: op.faccaoId,
        opSaldoId: opId,
      },
    });
  }

  // ─── Compra de insumo → a pagar ──────────────────────────────────────────

  /**
   * Compra de insumo → título do fornecedor, com o valor da compra e o
   * vencimento informado (sem ele, hoje). Tecido/Aviamento já categorizados.
   */
  async compraInsumoNaTx(
    tx: Tx,
    movimentoId: string,
    opts: { vencimento?: string | null; valorTotal?: number | null } = {},
  ) {
    const ja = await tx.finTitulo.findUnique({ where: { insumoMovimentoId: movimentoId } });
    if (ja) return ja;
    const m = await tx.insumoMovimento.findUnique({
      where: { id: movimentoId },
      select: {
        empresaId: true,
        tipo: true,
        quantidade: true,
        custoUnitario: true,
        documento: true,
        insumo: { select: { nome: true, tipo: true, fornecedor: true } },
        insumoCor: { select: { cor: { select: { nome: true } } } },
      },
    });
    if (!m || m.tipo !== 'ENTRADA_COMPRA') return null;
    // Insumo com cores: a conta diz QUAL cor foi comprada.
    const nome = m.insumoCor ? `${m.insumo.nome} ${m.insumoCor.cor.nome}` : m.insumo.nome;
    const valor =
      opts.valorTotal != null
        ? opts.valorTotal
        : Number(m.quantidade) * Number(m.custoUnitario ?? 0);
    if (!(valor > 0.004)) return null;
    const categoria = m.insumo.tipo === 'TECIDO' ? 'Tecido' : 'Aviamento';
    return tx.finTitulo.create({
      data: {
        empresaId: m.empresaId,
        tipo: 'PAGAR',
        descricao: `Compra de ${nome}${m.documento ? ` · NF/pedido ${m.documento}` : ''}`,
        valor: D(valor),
        vencimento: opts.vencimento ? new Date(`${opts.vencimento}T12:00:00.000Z`) : hojePuro(),
        categoriaId: await this.categoria(tx, m.empresaId, 'PAGAR', categoria),
        contatoNome: m.insumo.fornecedor ?? null,
        insumoMovimentoId: movimentoId,
      },
    });
  }
}
