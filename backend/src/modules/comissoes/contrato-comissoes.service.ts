import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';

/**
 * Linha que o recálculo NÃO pôde corrigir porque ela já virou conta a pagar no
 * ERP. O app não reescreve o que a contabilidade já lançou — mas também não
 * pode ficar calado, senão o mês segue pagando a % velha e ninguém sabe.
 */
export interface ComissaoDivergente {
  usuarioId: string;
  competencia: Date;
  tipo: string;
  /** O que está gravado (e já foi pro ERP). */
  percentualAtual: number;
  /** O que a regra de hoje manda. `null` = a pessoa deixou de ter direito. */
  percentualEsperado: number | null;
  contaPagarErpId: string;
}

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
  async recalcular(contratoId: string): Promise<ComissaoDivergente[]> {
    try {
      return await this.executar(contratoId);
    } catch (err) {
      this.logger.error(
        `Falha calculando comissões do contrato ${contratoId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  private async executar(contratoId: string): Promise<ComissaoDivergente[]> {
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
    if (!contrato) return [];

    if (SEM_COMISSAO.has(contrato.status)) {
      await this.zerarPendentes(contratoId, 'contrato sem comissão a pagar');
      return [];
    }

    // A regra da locação (Léo, 09/09), textual: "5% pro Leonardo, 5% pro Harada
    // e 10% pro representante, só isso, só essa regra".
    //
    // São DUAS coisas, e é por isso que têm tipos distintos:
    //
    //  PARTICIPACAO — fixa, de quem o tenant configurou, e NÃO depende de quem
    //                 vendeu. Contrato sem representante segue pagando.
    //  REP          — de quem é o representante DAQUELE contrato.
    //
    // Quando a mesma pessoa é as duas coisas, ela recebe as duas (5% + 10%). A
    // chave única inclui o tipo justamente pra isso: com um tipo só, a segunda
    // linha sobrescreveria a primeira e ela receberia metade.
    //
    // Vem da config do tenant, e não de `comissaoPadrao`, por dois motivos: a
    // participação é de PESSOAS ESPECÍFICAS (não "todo mundo que tem %"), e
    // `comissaoPadrao` já significa outra coisa no pedido de venda — reusar
    // mudaria a comissão de venda junto, que ninguém pediu.
    const regra = await this.regraDaLocacao(contrato.empresaId);

    const beneficiarios: Array<{ id: string; percentual: number; tipo: 'PARTICIPACAO' | 'REP' }> =
      [];
    for (const p of regra.participacao) {
      if (p.percentual > 0) {
        beneficiarios.push({ id: p.usuarioId, percentual: p.percentual, tipo: 'PARTICIPACAO' });
      }
    }
    if (contrato.representanteId && regra.representantePercentual > 0) {
      beneficiarios.push({
        id: contrato.representanteId,
        percentual: regra.representantePercentual,
        tipo: 'REP',
      });
    }

    // DESLIGADO não recebe. PENDENTE recebe: é quem foi convidado e ainda não
    // logou, e a % dele já foi decidida por quem configurou — deixar de fora
    // seria calote silencioso.
    const ativos = await this.prisma.usuario.findMany({
      where: {
        id: { in: beneficiarios.map((b) => b.id) },
        empresas: { some: { empresaId: contrato.empresaId } },
        status: { not: 'INATIVO' },
      },
      select: { id: true },
    });
    const podeReceber = new Set(ativos.map((u) => u.id));
    const linhasAtivas = beneficiarios.filter((b) => podeReceber.has(b.id));

    if (linhasAtivas.length === 0) {
      await this.zerarPendentes(contratoId, 'nenhum beneficiário ativo pela regra de locação');
      return [];
    }

    // Mês 1 = primeira cobrança (depois de qualquer carência), não a assinatura:
    // comissão de locação acompanha a MENSALIDADE, e a primeira só existe quando
    // o cliente começa a pagar.
    const inicio = mesUtc(contrato.primeiraCobrancaEm ?? contrato.criadoEm);
    const meses = competencias(inicio, contrato.prazoMeses);

    // Encerrado: o que já foi recebido continua valendo, o futuro não.
    const ate = contrato.status === 'ENCERRADO' ? new Date() : null;

    const base = new Prisma.Decimal(contrato.valorMensal);

    for (const competencia of meses) {
      if (ate && competencia > ate) continue;
      for (const b of linhasAtivas) {
        const pct = b.percentual;
        const valor = base.mul(pct).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const existente = await this.prisma.contratoComissao.findUnique({
          where: {
            contratoId_usuarioId_tipo_competencia: {
              contratoId,
              usuarioId: b.id,
              tipo: b.tipo,
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
              usuarioId: b.id,
              tipo: b.tipo,
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
      }
      // Linha que já virou conta no ERP não é reescrita por um recálculo: o
      // valor de lá é o que o financeiro viu, e o `upsert` que estava aqui
      // sobrescrevia sem olhar. Era inofensivo enquanto nada preenchia
      // `contaPagarErpId` — deixa de ser agora que a locação provisiona.
    }

    // Quem saiu da lista (perdeu a %, foi desligado, deixou de ser o
    // representante) some — salvo se já virou conta no ERP, que aí é zerada e
    // vira aviso, porque a API do Tiny não apaga conta.
    //
    // Casa por (pessoa, TIPO), não só por pessoa: com dois tipos, alguém que
    // deixou de ser o representante mas manteve a participação continuaria com a
    // linha REP velha se o filtro olhasse só o `usuarioId`.
    const par = linhasAtivas.map((b) => ({ usuarioId: b.id, tipo: b.tipo }));
    await this.prisma.contratoComissao.updateMany({
      where: { contratoId, NOT: par, contaPagarErpId: { not: null } },
      data: { valor: new Prisma.Decimal(0) },
    });
    await this.prisma.contratoComissao.deleteMany({
      where: { contratoId, NOT: par, contaPagarErpId: null },
    });

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

    // O que o recálculo NÃO conseguiu corrigir, e por que isso precisa gritar.
    //
    // Linha que já virou conta a pagar no ERP não é reescrita — e está certo:
    // app não muda em silêncio o que a contabilidade já lançou. Só que ficar
    // calado sobre isso é pior. Medido em 09/09: a regra virou 10% pro
    // representante, o recálculo rodou, e dois meses seguiram a 5% porque já
    // tinham conta no ERP. Nada no retorno, nada no log — dinheiro errado
    // parado, esperando a conciliação do mês descobrir.
    const esperado = new Map(linhasAtivas.map((b) => [`${b.id}|${b.tipo}`, b.percentual]));
    const comConta = await this.prisma.contratoComissao.findMany({
      where: { contratoId, contaPagarErpId: { not: null } },
      select: {
        usuarioId: true,
        tipo: true,
        competencia: true,
        percentual: true,
        contaPagarErpId: true,
      },
    });
    const divergentes: ComissaoDivergente[] = comConta
      .map((l) => ({
        usuarioId: l.usuarioId,
        competencia: l.competencia,
        tipo: String(l.tipo),
        percentualAtual: l.percentual,
        percentualEsperado: esperado.get(`${l.usuarioId}|${String(l.tipo)}`) ?? null,
        contaPagarErpId: String(l.contaPagarErpId),
      }))
      .filter((d) => d.percentualEsperado !== d.percentualAtual);

    if (divergentes.length > 0) {
      this.logger.warn(
        `Contrato ${contratoId}: ${divergentes.length} linha(s) de comissão JÁ no ERP ` +
          `divergem da regra atual e NÃO foram reescritas — ` +
          divergentes
            .map(
              (d) =>
                `${d.competencia.toISOString().slice(0, 7)} ${d.tipo} ` +
                `${d.percentualAtual}%→${d.percentualEsperado ?? 'sem direito'} ` +
                `(conta ${d.contaPagarErpId})`,
            )
            .join('; ') +
          '. Corrija no painel do ERP: a API do Tiny não altera nem apaga conta.',
      );
    }
    return divergentes;
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
  /**
   * A regra de comissão da LOCAÇÃO deste tenant.
   *
   * Mora em `Empresa.config.comissoes.locacao` porque é combinado comercial, e
   * combinado comercial muda sem deploy. Formato:
   *
   * ```json
   * { "comissoes": { "locacao": {
   *     "representantePercentual": 10,
   *     "participacao": [ { "usuarioId": "...", "percentual": 5 } ]
   * } } }
   * ```
   *
   * Ausente = nada é comissionado, e de propósito: melhor um contrato sem
   * comissão (que alguém nota e reclama) do que comissão inventada por um
   * default (que ninguém nota e vira dinheiro pago errado).
   */
  private async regraDaLocacao(empresaId: string): Promise<{
    representantePercentual: number;
    participacao: Array<{ usuarioId: string; percentual: number }>;
  }> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const cfg = ((empresa?.config as Record<string, unknown> | null)?.comissoes ?? {}) as {
      locacao?: {
        representantePercentual?: number;
        participacao?: Array<{ usuarioId?: string; percentual?: number }>;
      };
    };
    const loc = cfg.locacao ?? {};
    const participacao = (loc.participacao ?? [])
      .filter((p): p is { usuarioId: string; percentual: number } =>
        Boolean(p?.usuarioId && typeof p.percentual === 'number'),
      )
      .map((p) => ({ usuarioId: p.usuarioId, percentual: p.percentual }));
    if (!loc.representantePercentual && participacao.length === 0) {
      this.logger.warn(
        `Empresa ${empresaId} sem regra de comissão de locação em ` +
          `config.comissoes.locacao — nenhum contrato comissiona`,
      );
    }
    return { representantePercentual: loc.representantePercentual ?? 0, participacao };
  }

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
