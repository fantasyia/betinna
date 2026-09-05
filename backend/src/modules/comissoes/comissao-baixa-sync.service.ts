import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyContasService } from '@integrations/tiny/tiny-contas.service';

export interface ResultadoBaixaSync {
  conferidas: number;
  baixadas: number;
  erros: number;
}

/**
 * "Paga" na tela do rep = conta a pagar BAIXADA no ERP.
 *
 * Sem isto, a comissão ficava eternamente em "a pagar em 05/MM": o app criava a
 * conta no Tiny e nunca mais olhava pra ela, então quem já tinha recebido via a
 * mesma coisa de quem não recebeu — e a única forma de saber era perguntar pro
 * financeiro.
 *
 * O ERP é a fonte da verdade do pagamento (é lá que o financeiro baixa), então
 * o app **lê** o estado de lá; não existe "marcar como pago" no app, que
 * criaria duas verdades sobre dinheiro que saiu.
 *
 * A varredura é barata de propósito: só linhas que já têm conta e ainda não têm
 * `pagoEm` — uma linha paga nunca mais é consultada.
 */
@Injectable()
export class ComissaoBaixaSyncService {
  private readonly logger = new Logger(ComissaoBaixaSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contas: TinyContasService,
  ) {}

  async varrer(empresaId: string): Promise<ResultadoBaixaSync> {
    const r: ResultadoBaixaSync = { conferidas: 0, baixadas: 0, erros: 0 };

    const [vendas, locacoes] = await Promise.all([
      this.prisma.pedidoComissao.findMany({
        where: { empresaId, contaPagarErpId: { not: null }, pagoEm: null },
        select: { id: true, contaPagarErpId: true },
      }),
      this.prisma.contratoComissao.findMany({
        where: { empresaId, contaPagarErpId: { not: null }, pagoEm: null },
        select: { id: true, contaPagarErpId: true },
      }),
    ]);

    for (const { id, contaPagarErpId, tabela } of [
      ...vendas.map((v) => ({ ...v, tabela: 'pedido' as const })),
      ...locacoes.map((l) => ({ ...l, tabela: 'contrato' as const })),
    ]) {
      const contaId = Number(contaPagarErpId);
      if (!Number.isFinite(contaId)) continue;
      r.conferidas += 1;
      try {
        const conta = await this.contas.obterContaPagar(empresaId, contaId);
        // 'parcial' NÃO é pago: comissão paga pela metade continua a pagar, e
        // marcar como quitada esconderia o resto do dinheiro do rep.
        if (conta?.situacao !== 'pago') continue;
        // `dataLiquidacao` é quando o dinheiro saiu de verdade; sem ela (conta
        // antiga, campo vazio), o "descobrimos agora" é honesto o bastante.
        const pagoEm = conta.dataLiquidacao
          ? new Date(`${conta.dataLiquidacao}T12:00:00Z`)
          : new Date();
        if (tabela === 'pedido') {
          await this.prisma.pedidoComissao.update({ where: { id }, data: { pagoEm } });
        } else {
          await this.prisma.contratoComissao.update({ where: { id }, data: { pagoEm } });
        }
        r.baixadas += 1;
      } catch (err) {
        r.erros += 1;
        this.logger.warn(
          `Conta ${contaId} não conferida (comissão ${id}): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (r.baixadas > 0) {
      this.logger.log(
        `[comissão] ${r.baixadas} de ${r.conferidas} conta(s) baixada(s) no ERP — linhas marcadas como PAGAS`,
      );
    }
    return r;
  }
}
