import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { TinyContasService } from '@integrations/tiny/tiny-contas.service';

/** Enum de forma de pagamento do Tiny (o mesmo das contas a pagar). */
const FORMA_TINY: Record<string, number> = { PIX: 15, BOLETO: 5 };
/** Categoria de receita padrão — só entra se existir no ERP com esse nome. */
const CATEGORIA_RECEITA = 'Vendas';

/** Dias de cada parcela, pela condição gravada no pedido. */
const DIAS_POR_CONDICAO: Record<string, number[]> = {
  avista: [0],
  '30dias': [30],
  '30_60': [30, 60],
  '30_60_90': [30, 60, 90],
};

export interface ContaReceberLancada {
  id: number;
  parcela: number;
  valor: number;
  vencimento: string;
}

export type ResultadoLancamento =
  | { efeito: 'lancado'; contas: ContaReceberLancada[] }
  | { efeito: 'jaLancado' }
  | { efeito: 'semContato' }
  | { efeito: 'semValor' };

/**
 * Conta a receber no ERP quando o pedido FATURA.
 *
 * O Tiny só gera contas a receber a partir das PARCELAS do pedido, e o pedido
 * que sobe daqui não leva parcela nenhuma — a nota nasce sem elas e o
 * financeiro fica em branco ("Não existem parcelas cadastradas"). Em vez de
 * torcer pra configuração do painel, o app lança a conta ele mesmo, com o
 * mesmo desenho das contas a pagar de comissão: forma de pagamento, ocorrência
 * única, histórico que diz de qual nota e de qual pedido é.
 *
 * Idempotente pelo `Pedido.contasReceberErp`: lançou uma vez, não lança de
 * novo — a rodada diária passa pelo mesmo pedido todo dia.
 */
@Injectable()
export class PedidoFinanceiroErpService {
  private readonly logger = new Logger(PedidoFinanceiroErpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contas: TinyContasService,
  ) {}

  async lancarContasReceber(
    empresaId: string,
    pedidoId: string,
    nota: { numero?: number | string; serie?: number | string } | null,
  ): Promise<ResultadoLancamento> {
    const p = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, empresaId },
      select: {
        numero: true,
        numeroSite: true,
        numeroErp: true,
        total: true,
        formaPagamento: true,
        condicaoPagamento: true,
        contasReceberErp: true,
        cliente: { select: { nome: true, codigoErp: true } },
      },
    });
    if (!p) return { efeito: 'semValor' };
    if (Array.isArray(p.contasReceberErp) && p.contasReceberErp.length > 0) {
      return { efeito: 'jaLancado' };
    }
    const total = Math.round(Number(p.total) * 100) / 100;
    if (total <= 0) return { efeito: 'semValor' };
    const contato = Number(p.cliente?.codigoErp ?? 0);
    if (!contato) {
      this.logger.warn(
        `[erp] ${p.numero}: cliente sem contato no ERP — conta a receber não lançada`,
      );
      return { efeito: 'semContato' };
    }

    const dias = DIAS_POR_CONDICAO[(p.condicaoPagamento ?? 'avista').trim()] ?? [0];
    const valores = this.dividir(total, dias.length);
    const forma = FORMA_TINY[p.formaPagamento] ?? FORMA_TINY.PIX;
    const idCategoria =
      (await this.contas.acharCategoria(empresaId, CATEGORIA_RECEITA)) ?? undefined;
    const rotulo = [p.numeroSite, p.numero, p.numeroErp ? `ERP ${p.numeroErp}` : '']
      .filter(Boolean)
      .join(' / ');
    const nf = nota?.numero ? `NF ${nota.numero}${nota.serie ? ` série ${nota.serie}` : ''}` : 'NF';
    const hoje = this.hojeBrt();

    const contas: ContaReceberLancada[] = [];
    for (let i = 0; i < dias.length; i++) {
      const vencimento = this.somarDias(hoje, dias[i]);
      const id = await this.contas.criarContaReceber(empresaId, {
        idContato: contato,
        valor: valores[i],
        dataVencimento: vencimento,
        dataCompetencia: hoje.slice(0, 7),
        numeroDocumento: p.numeroSite ?? p.numero,
        historico: `${nf} · pedido ${rotulo} · parcela ${i + 1}/${dias.length}`,
        idCategoria,
        formaPagamento: forma,
        // Venda é lançamento ÚNICO. Recorrência é só da mensalidade de locação.
        ocorrencia: 'U',
      });
      contas.push({ id, parcela: i + 1, valor: valores[i], vencimento });
    }

    await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: { contasReceberErp: contas as unknown as Prisma.InputJsonValue },
    });
    this.logger.log(
      `[erp] ${p.numero}: ${contas.length} conta(s) a receber lançada(s) — ${contas.map((c) => `#${c.id} R$${c.valor.toFixed(2)} ${c.vencimento}`).join(', ')}`,
    );
    return { efeito: 'lancado', contas };
  }

  /** Divide em centavos exatos; a diferença de arredondamento vai na última. */
  private dividir(total: number, n: number): number[] {
    const centavos = Math.round(total * 100);
    const base = Math.floor(centavos / n);
    const sobra = centavos - base * n;
    return Array.from({ length: n }, (_, i) => (base + (i === n - 1 ? sobra : 0)) / 100);
  }

  private hojeBrt(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  }

  private somarDias(iso: string, dias: number): string {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }
}
