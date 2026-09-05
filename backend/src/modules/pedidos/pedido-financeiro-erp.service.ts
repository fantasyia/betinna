import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { TinyContasService } from '@integrations/tiny/tiny-contas.service';
import { TinyPedidosService } from '@integrations/tiny/tiny-pedidos.service';
import { FORMA_TINY, dividirEmParcelas } from './parcelas.util';

/** Categoria de receita padrão — só entra se existir no ERP com esse nome. */
const CATEGORIA_RECEITA = 'Vendas';

export interface ContaReceberLancada {
  id: number;
  parcela: number;
  valor: number;
  vencimento: string;
}

export type ResultadoLancamento =
  | { efeito: 'lancado'; contas: ContaReceberLancada[] }
  /** O Tiny gerou as contas a partir das parcelas da nota — ele estorna junto no cancelamento. */
  | { efeito: 'lancadoPeloTiny'; idNota: number }
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
    private readonly tiny: TinyPedidosService,
  ) {}

  async lancarContasReceber(
    empresaId: string,
    pedidoId: string,
    nota: { id?: number; numero?: number | string; serie?: number | string } | null,
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

    // Caminho preferido: o pedido subiu COM parcelas, então a nota tem
    // parcelas e o Tiny gera as contas dele mesmo — e as estorna junto quando a
    // nota é cancelada. Só cai no lançamento manual se o Tiny recusar (pedido
    // antigo, sem parcelas).
    if (nota?.id) {
      // O Tiny costuma gerar as contas SOZINHO na autorização da nota; aí o
      // `lancar-contas` volta 400 "Já existem contas lançadas" — isso é
      // sucesso, não falha. O que decide é a lista de contas da nota.
      try {
        await this.tiny.lancarContasDaNota(empresaId, nota.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/j[aá] existem/i.test(msg)) {
          this.logger.warn(`[erp] ${p.numero}: Tiny não gerou as contas da nota (${msg})`);
        }
      }
      const doTiny = await this.contas
        .listarContasReceberDaNota(empresaId, nota.id)
        .catch(() => [] as Array<{ id: number }>);
      if (doTiny.length > 0) {
        // Categoria "Vendas": o Tiny cria a conta sem categoria; o PUT aceita.
        const idCategoria = await this.contas.acharCategoria(empresaId, CATEGORIA_RECEITA);
        if (idCategoria) {
          for (const c of doTiny) {
            await this.contas
              .categorizarContaReceber(empresaId, c.id, idCategoria)
              .catch((err: unknown) =>
                this.logger.warn(
                  `[erp] conta a receber ${c.id} sem categoria: ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
          }
        }
        await this.prisma.pedido.update({
          where: { id: pedidoId },
          data: {
            contasReceberErp: [
              { origem: 'tiny', idNota: nota.id, ids: doTiny.map((c) => c.id) },
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        this.logger.log(
          `[erp] ${p.numero}: ${doTiny.length} conta(s) a receber geradas pelo Tiny a partir da NF ${nota.numero ?? nota.id}`,
        );
        return { efeito: 'lancadoPeloTiny', idNota: nota.id };
      }
      this.logger.warn(
        `[erp] ${p.numero}: a NF ${nota.numero ?? nota.id} não gerou contas no Tiny — lançando pelo app`,
      );
    }

    const contato = Number(p.cliente?.codigoErp ?? 0);
    if (!contato) {
      this.logger.warn(
        `[erp] ${p.numero}: cliente sem contato no ERP — conta a receber não lançada`,
      );
      return { efeito: 'semContato' };
    }

    const parcelas = dividirEmParcelas(total, p.condicaoPagamento);
    const dias = parcelas.map((x) => x.dias);
    const valores = parcelas.map((x) => x.valor);
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

  private hojeBrt(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  }

  private somarDias(iso: string, dias: number): string {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }
}
