import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';

/** Contrato nesses estados não gera comissão nenhuma — e zera a que existia. */
const SEM_COMISSAO = new Set(['CANCELADO', 'RASCUNHO', 'AGUARDANDO_ASSINATURA']);

/**
 * Comissão de LOCAÇÃO — uma linha por contrato × pessoa × MÊS.
 *
 * A regra (Léo, 05/09): **venda paga uma vez; locação paga todo mês.** O rep que
 * fechou um contrato de 36 meses recebe 36 vezes, e cada parcela só vira dinheiro
 * quando **a mensalidade daquele mês entra** — não na instalação (o cliente ainda
 * não pagou nada) e não no vencimento (vencer não é receber).
 *
 * Por que a linha nasce antes de a mensalidade entrar: o rep precisa VER o que
 * vem pela frente. Uma linha por mês, em `AGUARDANDO_MENSALIDADE`, é o contrato
 * inteiro à vista; quando o dinheiro do cliente entra, aquele mês vira `A_PAGAR`
 * e segue o mesmo caminho da comissão de venda (conta a pagar no ERP, venc. dia
 * 05 do mês seguinte).
 *
 * Recalcular é idempotente — a linha é única por (contrato, pessoa, tipo, mês).
 */
@Injectable()
export class ContratoComissoesService {
  private readonly logger = new Logger(ContratoComissoesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Refaz o cronograma de comissão de um contrato.
   *
   * **Best-effort**, igual ao da venda: comissão errada se conserta recalculando;
   * derrubar a ativação de um contrato por causa dela seria trocar um problema
   * pequeno por um grande.
   */
  async recalcular(contratoId: string): Promise<void> {
    try {
      await this.executar(contratoId);
    } catch (err) {
      this.logger.error(
        `Falha calculando comissões do contrato ${contratoId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async executar(contratoId: string): Promise<void> {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: {
        id: true,
        empresaId: true,
        status: true,
        valorMensal: true,
        prazoMeses: true,
        primeiraCobrancaEm: true,
        criadoEm: true,
        representanteId: true,
      },
    });
    if (!contrato) return;

    if (SEM_COMISSAO.has(contrato.status) || !contrato.representanteId) {
      await this.zerarPendentes(contratoId, 'contrato sem comissão a pagar');
      return;
    }

    const rep = await this.prisma.usuario.findUnique({
      where: { id: contrato.representanteId },
      select: { comissaoPadrao: true },
    });
    const pct = rep?.comissaoPadrao ?? 0;
    if (pct <= 0) {
      await this.zerarPendentes(contratoId, 'representante sem % de comissão');
      return;
    }

    // Mês 1 = primeira cobrança (depois de qualquer carência), não a assinatura:
    // comissão de locação acompanha a MENSALIDADE, e a primeira só existe quando
    // o cliente começa a pagar.
    const inicio = mesUtc(contrato.primeiraCobrancaEm ?? contrato.criadoEm);
    const meses = competencias(inicio, contrato.prazoMeses);

    // Encerrado: o que já foi recebido continua valendo, o futuro não.
    const ate = contrato.status === 'ENCERRADO' ? new Date() : null;

    const base = new Prisma.Decimal(contrato.valorMensal);
    const valor = base.mul(pct).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    for (const competencia of meses) {
      if (ate && competencia > ate) continue;
      const existente = await this.prisma.contratoComissao.findUnique({
        where: {
          contratoId_usuarioId_tipo_competencia: {
            contratoId,
            usuarioId: contrato.representanteId,
            tipo: 'REP',
            competencia,
          },
        },
        select: { id: true, contaPagarErpId: true },
      });
      if (!existente) {
        await this.prisma.contratoComissao.create({
          data: {
            empresaId: contrato.empresaId,
            contratoId,
            usuarioId: contrato.representanteId,
            tipo: 'REP',
            competencia,
            percentual: pct,
            base,
            valor,
          },
        });
      } else if (!existente.contaPagarErpId) {
        await this.prisma.contratoComissao.update({
          where: { id: existente.id },
          data: { percentual: pct, base, valor },
        });
      }
      // Linha que já virou conta no ERP não é reescrita por um recálculo: o
      // valor de lá é o que o financeiro viu, e o `upsert` que estava aqui
      // sobrescrevia sem olhar. Era inofensivo enquanto nada preenchia
      // `contaPagarErpId` — deixa de ser agora que a locação provisiona.
    }

    if (ate) {
      const { count } = await this.prisma.contratoComissao.deleteMany({
        where: { contratoId, contaPagarErpId: null, competencia: { gt: ate } },
      });
      if (count > 0) {
        this.logger.log(
          `Contrato ${contratoId} encerrado — ${count} mês(es) futuro(s) de comissão removido(s)`,
        );
      }
    }
  }

  /**
   * A mensalidade daquele mês entrou: o mês passa a valer como comissão.
   *
   * Este é o GATILHO da locação. É idempotente (regravar a mesma data não muda
   * nada) e não mexe em linha que já virou conta no ERP.
   */
  async registrarMensalidadeRecebida(
    contratoId: string,
    competencia: Date,
    recebidaEm = new Date(),
  ): Promise<number> {
    const { count } = await this.prisma.contratoComissao.updateMany({
      where: {
        contratoId,
        competencia: mesUtc(competencia),
        mensalidadeRecebidaEm: null,
      },
      data: { mensalidadeRecebidaEm: recebidaEm },
    });
    if (count > 0) {
      this.logger.log(
        `Contrato ${contratoId}: mensalidade de ${competencia.toISOString().slice(0, 7)} ` +
          `recebida — ${count} comissão(ões) liberada(s) pra provisionamento`,
      );
    }
    return count;
  }

  /** Zera o que ainda não virou conta (e apaga de vez o que nem chegou lá). */
  private async zerarPendentes(contratoId: string, motivo: string): Promise<void> {
    const zeradas = await this.prisma.contratoComissao.updateMany({
      where: { contratoId, contaPagarErpId: { not: null } },
      data: { valor: new Prisma.Decimal(0) },
    });
    const { count } = await this.prisma.contratoComissao.deleteMany({
      where: { contratoId, contaPagarErpId: null },
    });
    if (count > 0 || zeradas.count > 0) {
      this.logger.log(
        `Contrato ${contratoId} (${motivo}) — ${count} comissão(ões) removida(s), ` +
          `${zeradas.count} zerada(s) (já tinham conta no ERP)`,
      );
    }
  }
}

/** Primeiro dia do mês, em UTC — a competência é o MÊS, não o dia. */
export function mesUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Os `n` meses de competência a partir de `inicio` (inclusive). */
export function competencias(inicio: Date, n: number): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < n; i++) {
    out.push(new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + i, 1)));
  }
  return out;
}
