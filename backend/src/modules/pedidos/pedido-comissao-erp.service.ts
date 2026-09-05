import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyContasService } from '@integrations/tiny/tiny-contas.service';

const CATEGORIA = 'Comissões sobre vendas';
const FORMA_PAGAMENTO_PIX = 15;

export interface ResultadoProvisaoPedido {
  criadas: number;
  atualizadas: number;
  /** Beneficiário sem contato no ERP — não há a quem pagar. */
  semContato: string[];
  /** Linhas que ZERARAM (cancelamento/devolução) mas já têm conta lá — apagar à mão. */
  paraApagar: string[];
  erros: number;
}

/**
 * Conta a pagar de comissão POR PEDIDO — uma por beneficiário, quando a NF sai.
 *
 * Decisão do Léo (05/09): a comissão não espera o fechamento do mês; cada
 * pedido faturado gera a sua conta a pagar no ERP, e o financeiro enxerga de
 * qual venda é cada centavo. O fechamento mensal continua existindo como
 * FOLHA (o resumo por pessoa na tela), mas não provisiona mais REP/SITE — só
 * GERENTE, que não tem linha por pedido.
 *
 * Vence dia 05 do mês seguinte ao faturamento (a mesma regra da folha).
 * Idempotente por `PedidoComissao.contaPagarErpId`; valor que muda depois
 * (devolução, frete) é reescrito na conta; valor que ZERA vira aviso — a API
 * não apaga conta, e PUT com zero não é o que o financeiro quer ver.
 */
@Injectable()
export class PedidoComissaoErpService {
  private readonly logger = new Logger(PedidoComissaoErpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contas: TinyContasService,
  ) {}

  /** Cria as contas que faltam e reescreve as que mudaram de valor. */
  async provisionar(
    empresaId: string,
    pedidoId: string,
    nota: { numero?: number | string; serie?: number | string } | null,
    /** `criar: false` = só reescreve/avisa sobre contas que já existem (pedido ainda sem NF). */
    opcoes: { criar: boolean },
  ): Promise<ResultadoProvisaoPedido> {
    const r: ResultadoProvisaoPedido = {
      criadas: 0,
      atualizadas: 0,
      semContato: [],
      paraApagar: [],
      erros: 0,
    };
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, empresaId },
      select: {
        numero: true,
        numeroSite: true,
        numeroErp: true,
        enviadoErpEm: true,
        comissoesPedido: {
          select: {
            id: true,
            tipo: true,
            percentual: true,
            valor: true,
            contaPagarErpId: true,
            contaPagarValor: true,
            usuario: { select: { nome: true, contatoErpId: true } },
          },
        },
      },
    });
    if (!pedido || pedido.comissoesPedido.length === 0) return r;

    const rotulo = [
      pedido.numeroSite,
      pedido.numero,
      pedido.numeroErp ? `ERP ${pedido.numeroErp}` : '',
    ]
      .filter(Boolean)
      .join(' / ');
    const nf = nota?.numero
      ? ` · NF ${nota.numero}${nota.serie ? ` série ${nota.serie}` : ''}`
      : '';
    const ref = pedido.enviadoErpEm ?? new Date();
    const { mes, ano } = this.mesBrt(ref);
    const vencimento = this.vencimentoDia5(mes, ano);
    const competencia = `${ano}-${String(mes).padStart(2, '0')}`;
    const idCategoria = (await this.contas.acharCategoria(empresaId, CATEGORIA)) ?? undefined;

    for (const l of pedido.comissoesPedido) {
      const valor = Math.round(Number(l.valor) * 100) / 100;
      const contato = Number(l.usuario?.contatoErpId ?? 0);
      const nome = l.usuario?.nome ?? '?';
      const lancamento = {
        idContato: contato,
        valor,
        dataVencimento: vencimento,
        dataCompetencia: competencia,
        numeroDocumento: `COMISSAO ${pedido.numeroSite ?? pedido.numero}`,
        historico: `Comissão ${l.tipo} ${l.percentual}% — ${nome} · pedido ${rotulo}${nf}`,
        idCategoria,
        formaPagamento: FORMA_PAGAMENTO_PIX,
        ocorrencia: 'U' as const,
      };
      try {
        if (l.contaPagarErpId) {
          if (valor <= 0) {
            r.paraApagar.push(`conta ${l.contaPagarErpId} (${nome}, ${rotulo})`);
            continue;
          }
          if (Number(l.contaPagarValor ?? -1) === valor) continue;
          await this.contas.atualizarContaPagar(empresaId, Number(l.contaPagarErpId), lancamento);
          await this.prisma.pedidoComissao.update({
            where: { id: l.id },
            data: { contaPagarValor: valor },
          });
          r.atualizadas += 1;
          continue;
        }
        if (valor <= 0 || !opcoes.criar) continue;
        if (!contato) {
          r.semContato.push(nome);
          continue;
        }
        const id = await this.contas.criarContaPagar(empresaId, lancamento);
        await this.prisma.pedidoComissao.update({
          where: { id: l.id },
          data: { contaPagarErpId: String(id), contaPagarValor: valor },
        });
        r.criadas += 1;
      } catch (err) {
        r.erros += 1;
        this.logger.error(
          `[erp] comissão de ${nome} no pedido ${pedido.numero} não provisionada: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (r.criadas || r.atualizadas || r.paraApagar.length) {
      this.logger.log(
        `[erp] comissão do pedido ${pedido.numero}: ${r.criadas} conta(s) criada(s), ${r.atualizadas} atualizada(s)` +
          (r.paraApagar.length ? ` — apagar no ERP: ${r.paraApagar.join('; ')}` : ''),
      );
    }
    return r;
  }

  private mesBrt(d: Date): { mes: number; ano: number } {
    const brt = new Date(d.getTime() - 3 * 3_600_000);
    return { mes: brt.getUTCMonth() + 1, ano: brt.getUTCFullYear() };
  }

  private vencimentoDia5(mes: number, ano: number): string {
    const proximoMes = mes === 12 ? 1 : mes + 1;
    const anoDoVencimento = mes === 12 ? ano + 1 : ano;
    return `${anoDoVencimento}-${String(proximoMes).padStart(2, '0')}-05`;
  }
}
