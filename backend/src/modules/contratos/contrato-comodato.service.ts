import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ContratoComissoesService } from '@modules/comissoes/contrato-comissoes.service';

/** Só o que interessa da NF aqui: quando ela saiu. */
export interface NotaDoComodato {
  numero?: number | string;
  dataEmissao?: string;
}

/**
 * Quando a cobrança mensal da locação começa a contar.
 *
 * Regra do Léo (05/09): a mensalidade nasce a partir da **emissão da NF de
 * comodato**, que sai assim que o pedido fica pronto pra envio. Antes disso o
 * equipamento nem saiu da empresa — cobrar (e comissionar) desde a assinatura
 * seria cobrar por uma máquina que o cliente ainda não tem.
 *
 * Sem isto, `Contrato.primeiraCobrancaEm` não era escrito por ninguém e o
 * cronograma de comissão caía no fallback `criadoEm`: começava no aceite da
 * proposta, possivelmente meses antes da instalação, e todas as 36 competências
 * saíam deslocadas.
 *
 * O elo entre pedido e contrato é `Pedido.propostaNumero` → `Proposta.numero` →
 * `Contrato.propostaId`: os dois nascem do mesmo aceite, e não existe FK direta.
 */
@Injectable()
export class ContratoComodatoService {
  private readonly logger = new Logger(ContratoComodatoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comissoes: ContratoComissoesService,
  ) {}

  /**
   * A NF do pedido de locação saiu: marca o início da cobrança e refaz o
   * cronograma de comissão a partir dele.
   *
   * Idempotente — contrato que já tem data não é remarcado. Reemitir nota (ou
   * a rodada diária passar de novo pelo mesmo pedido) não pode empurrar a
   * primeira competência pra frente.
   */
  async iniciarCobranca(
    empresaId: string,
    pedidoId: string,
    nota: NotaDoComodato | null,
  ): Promise<void> {
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, empresaId },
      select: { numero: true, modalidade: true, propostaNumero: true },
    });
    if (!pedido || pedido.modalidade !== 'LOCACAO' || !pedido.propostaNumero) return;

    const proposta = await this.prisma.proposta.findFirst({
      where: { empresaId, numero: pedido.propostaNumero },
      select: { id: true },
    });
    if (!proposta) return;

    const contrato = await this.prisma.contrato.findUnique({
      where: { propostaId: proposta.id },
      select: { id: true, primeiraCobrancaEm: true },
    });
    if (!contrato || contrato.primeiraCobrancaEm) return;

    const inicio = this.dataDaNota(nota);
    await this.prisma.contrato.update({
      where: { id: contrato.id },
      data: { primeiraCobrancaEm: inicio },
    });
    // Refaz as competências a partir da data certa. `recalcular` é best-effort
    // e não reescreve mês que já virou conta no ERP.
    await this.comissoes.recalcular(contrato.id);
    this.logger.log(
      `Contrato ${contrato.id}: NF de comodato ${nota?.numero ?? '?'} do pedido ${pedido.numero} ` +
        `— cobrança mensal começa em ${inicio.toISOString().slice(0, 10)}`,
    );
  }

  /**
   * Data da emissão da nota. Sem ela, o momento em que o app viu a NF válida:
   * a competência é o MÊS, e o sync roda todo dia — a diferença só apareceria
   * numa nota emitida na virada do mês.
   */
  private dataDaNota(nota: NotaDoComodato | null): Date {
    const bruto = nota?.dataEmissao;
    const dia = typeof bruto === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(bruto)?.[0] : null;
    return dia ? new Date(`${dia}T12:00:00.000Z`) : new Date();
  }
}
