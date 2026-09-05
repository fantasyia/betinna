import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyContasService, type ContaReceberResumo } from '@integrations/tiny/tiny-contas.service';
import { ContratoComissaoErpService } from '@modules/comissoes/contrato-comissao-erp.service';

/** Série que o Tiny usa na cobrança de contrato. NF usa a série da nota ("3"). */
const SERIE_COBRANCA_CONTRATO = 'D';
/** "Referente à cobrança de contrato 09/2026 e RPS nº 000000001" */
const RX_COMPETENCIA = /cobran[çc]a de contrato\s+(\d{2})\/(\d{4})/i;
/** Centavos de diferença tolerados entre a mensalidade e a cobrança. */
const TOLERANCIA = 0.01;

export interface ResultadoMensalidadeSync {
  cobrancasPagas: number;
  mensalidadesRegistradas: number;
  comissoesProvisionadas: number;
  avisos: string[];
}

/**
 * Descobre sozinho que a mensalidade da locação foi paga.
 *
 * O caminho é este, medido no ERP em 05/09: o contrato no Tiny é só o plano; a
 * cobrança nasce quando alguém roda **Serviços → Cobranças → gerar cobranças do
 * período** (não existe rota de API pra isso), e cada mês vira uma conta a
 * receber com série **D**, competência no histórico e vencimento no mês seguinte.
 * Quando o financeiro baixa essa conta, a mensalidade daquele mês entrou — e é
 * só aí que a comissão do rep vira dinheiro.
 *
 * **Não existe id de contrato na conta a receber** — nem na v2, nem na v3 (o
 * campo simplesmente não existe no recurso). Então o vínculo é feito por quatro
 * sinais juntos: série D + competência do histórico + id do cliente no ERP +
 * valor igual à mensalidade. E quando dois contratos do mesmo cliente casam com
 * o mesmo mês e valor, o app **não escolhe**: registra aviso e não paga nada.
 * Adivinhar aqui é pagar comissão sobre dinheiro que não entrou.
 */
@Injectable()
export class ContratoMensalidadeSyncService {
  private readonly logger = new Logger(ContratoMensalidadeSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contas: TinyContasService,
    private readonly erpLocacao: ContratoComissaoErpService,
  ) {}

  async varrer(empresaId: string): Promise<ResultadoMensalidadeSync> {
    const r: ResultadoMensalidadeSync = {
      cobrancasPagas: 0,
      mensalidadesRegistradas: 0,
      comissoesProvisionadas: 0,
      avisos: [],
    };

    // Só contrato que tem mês esperando mensalidade. Contrato quitado ou sem
    // comissão pendente não custa uma chamada de API.
    const contratos = await this.prisma.contrato.findMany({
      where: {
        empresaId,
        status: { not: 'CANCELADO' },
        comissoes: { some: { mensalidadeRecebidaEm: null, valor: { gt: 0 } } },
      },
      select: {
        id: true,
        valorMensal: true,
        cliente: { select: { codigoErp: true, nome: true } },
        comissoes: {
          where: { mensalidadeRecebidaEm: null, valor: { gt: 0 } },
          select: { competencia: true },
        },
      },
    });
    if (contratos.length === 0) return r;

    const pendentes = contratos.flatMap((c) => c.comissoes.map((m) => m.competencia));
    const janela = this.janelaDeVencimento(pendentes);

    // `situacao: 'pago'` do lado do ERP: o que interessa é dinheiro que entrou.
    // 'parcial' NÃO conta — mensalidade paga pela metade não libera a comissão.
    const cobrancas = await this.contas.listarContasReceber(empresaId, {
      de: janela.de,
      ate: janela.ate,
      situacao: 'pago',
    });

    for (const cobranca of cobrancas) {
      const competencia = this.competenciaDa(cobranca);
      if (!competencia) continue;
      r.cobrancasPagas += 1;

      const candidatos = contratos.filter(
        (c) =>
          String(c.cliente?.codigoErp ?? '') === String(cobranca.cliente?.id ?? '') &&
          Math.abs(Number(c.valorMensal) - Number(cobranca.valor ?? 0)) <= TOLERANCIA &&
          c.comissoes.some((m) => m.competencia.getTime() === competencia.getTime()),
      );
      if (candidatos.length === 0) continue;
      if (candidatos.length > 1) {
        // Dois contratos do mesmo cliente, mesmo valor, mesmo mês: não dá pra
        // saber qual foi pago, e chutar pagaria comissão errada.
        r.avisos.push(
          `Conta a receber ${cobranca.id} (${cobranca.cliente?.nome ?? '?'}, ` +
            `${this.rotulo(competencia)}, R$ ${Number(cobranca.valor ?? 0).toFixed(2)}) casa com ` +
            `${candidatos.length} contratos — mensalidade NÃO registrada, confira à mão`,
        );
        continue;
      }

      const contrato = candidatos[0];
      try {
        // `dataLiquidacao` é quando o dinheiro entrou de verdade; só o detalhe
        // da conta traz esse campo, e só se busca pelas que já casaram.
        const detalhe = await this.contas.obterContaReceber(empresaId, cobranca.id);
        const recebidaEm = detalhe?.dataLiquidacao
          ? new Date(`${detalhe.dataLiquidacao}T12:00:00.000Z`)
          : new Date();

        const res = await this.erpLocacao.mensalidadeRecebida(
          empresaId,
          contrato.id,
          competencia,
          recebidaEm,
        );
        if (res.liberadas > 0) r.mensalidadesRegistradas += 1;
        r.comissoesProvisionadas += res.criadas;
        for (const nome of res.semContato) {
          r.avisos.push(
            `${nome} não tem contato no ERP — comissão de ${this.rotulo(competencia)} não provisionada`,
          );
        }
      } catch (err) {
        r.avisos.push(
          `Conta a receber ${cobranca.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (r.mensalidadesRegistradas > 0 || r.avisos.length > 0) {
      this.logger.log(
        `[locação] ${r.mensalidadesRegistradas} mensalidade(s) recebida(s) de ` +
          `${r.cobrancasPagas} cobrança(s) paga(s) — ${r.comissoesProvisionadas} comissão(ões) provisionada(s)`,
      );
    }
    return r;
  }

  /**
   * A cobrança daquele contrato, e de qual mês.
   *
   * Dois filtros: a série D (separa cobrança de contrato das contas que a NF
   * gera) e a competência escrita no histórico. O campo `dataCompetencia` do
   * detalhe também traz o mês, mas exigiria uma chamada por conta — o histórico
   * resolve na listagem.
   */
  private competenciaDa(c: ContaReceberResumo): Date | null {
    if (c.serieDocumento !== SERIE_COBRANCA_CONTRATO) return null;
    const m = RX_COMPETENCIA.exec(c.historico ?? '');
    if (!m) return null;
    const mes = Number(m[1]);
    const ano = Number(m[2]);
    if (!mes || mes > 12 || !ano) return null;
    return new Date(Date.UTC(ano, mes - 1, 1));
  }

  /**
   * Janela de vencimento a consultar.
   *
   * A cobrança vence DEPOIS da competência (o contrato do Tiny tem "vencimento
   * no mês seguinte"), e pode ser paga com atraso — por isso a folga pra frente.
   * Um mês pra trás cobre contrato configurado pra vencer no mês corrente.
   */
  private janelaDeVencimento(competencias: Date[]): { de: string; ate: string } {
    const ms = competencias.map((d) => d.getTime());
    const min = new Date(Math.min(...ms));
    const max = new Date(Math.max(...ms));
    const de = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth() - 1, 1));
    const ate = new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth() + 4, 0));
    return { de: de.toISOString().slice(0, 10), ate: ate.toISOString().slice(0, 10) };
  }

  private rotulo(competencia: Date): string {
    return competencia.toISOString().slice(0, 7);
  }
}
