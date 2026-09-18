import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';

/**
 * O acompanhamento (software) é OPCIONAL, e a escolha é por quadro — regra do
 * Léo, 18/09.
 *
 * Quando o cliente quer, o hardware muda conforme o papel do quadro:
 *
 * | quer acompanhamento? | qual quadro | variante  |
 * |---|---|---|
 * | não | qualquer | `BASE` — o Master Block puro |
 * | sim | o PRINCIPAL | `DATA_SENSE` — o concentrador, um por instalação |
 * | sim | os demais | `END_POINT` |
 */
export type VarianteAcompanhamento = 'BASE' | 'DATA_SENSE' | 'END_POINT';

/**
 * A convenção vive no SKU do catálogo: `MB-04`, `MB-04_D.S.`, `MB-04_E.P.`.
 *
 * 📌 É o catálogo que manda, não uma tabela aqui — os 36 produtos já existem
 * com essa nomenclatura, e inventar um campo novo criaria uma segunda fonte pra
 * mesma verdade.
 */
const SUFIXO: Record<VarianteAcompanhamento, string> = {
  BASE: '',
  DATA_SENSE: '_D.S.',
  END_POINT: '_E.P.',
};

/** O que o levantamento de campo mediu num quadro. */
export interface Medicao {
  /** Corrente de carga, em ampères. É ela que decide o modelo. */
  correnteA: number;
  /**
   * Com ou sem acompanhamento, e em que papel. Default `BASE`: sem o software,
   * que é a venda mais simples e a que não surpreende no preço.
   */
  variante?: VarianteAcompanhamento;
}

export interface ModeloEscolhido {
  produtoId: string;
  sku: string;
  nome: string;
  correnteMinA: number;
  correnteMaxA: number;
}

/**
 * Dada a CORRENTE medida no quadro, qual Master Block entra.
 *
 * A régua é a tabela oficial do Leandro (2026): os 12 modelos cobrem a mesma
 * faixa de tensão (110–1100V) e se diferenciam pela corrente de carga —
 * MB-01 de 1A a 125A, MB-02 até 250A, e assim por diante até 6300A.
 *
 * 📌 A faixa vive no PRODUTO (`correnteMinA`/`correnteMaxA`), não aqui. Este
 * serviço só consulta. É o que faz existir UMA fonte: quando o Leandro revisar
 * a linha, muda o cadastro e o app inteiro acompanha — sem alguém lembrar de
 * editar uma constante escondida no código.
 *
 * ⛔ Este serviço NÃO chuta. Corrente fora de toda faixa devolve `null` com o
 * motivo, e quem chamou decide o que dizer. Devolver "o maior que eu tenho"
 * seria o pior desfecho possível: modelo subdimensionado não protege a
 * instalação, e o prejuízo só aparece quando queima.
 */
@Injectable()
export class SelecaoModeloService {
  private readonly logger = new Logger(SelecaoModeloService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * O modelo para esta corrente, ou `null` com o motivo.
   *
   * `acima-da-linha` é separado de `sem-faixa-cadastrada` de propósito: o
   * primeiro é uma instalação que a linha não atende (resposta comercial —
   * projeto especial), o segundo é catálogo incompleto (resposta de cadastro).
   * Juntos num "não achei", ninguém sabe qual dos dois consertar.
   */
  async paraCorrente(
    empresaId: string,
    medicao: Medicao,
  ): Promise<
    | { ok: true; modelo: ModeloEscolhido }
    | {
        ok: false;
        motivo:
          | 'corrente-invalida'
          | 'acima-da-linha'
          | 'sem-faixa-cadastrada'
          | 'variante-indisponivel';
      }
  > {
    const corrente = Math.trunc(Number(medicao.correnteA));
    if (!Number.isFinite(corrente) || corrente <= 0) {
      return { ok: false, motivo: 'corrente-invalida' };
    }
    const variante = medicao.variante ?? 'BASE';

    const candidatos = await this.prisma.produto.findMany({
      where: {
        empresaId,
        ativo: true,
        correnteMinA: { not: null },
        correnteMaxA: { not: null },
      },
      select: {
        id: true,
        sku: true,
        nome: true,
        correnteMinA: true,
        correnteMaxA: true,
      },
      orderBy: { correnteMinA: 'asc' },
    });

    if (candidatos.length === 0) return { ok: false, motivo: 'sem-faixa-cadastrada' };

    // A faixa que CONTÉM a corrente. Ordenado por `correnteMinA`, a primeira que
    // contém é a menor que atende — e a menor que atende é a certa: subir de
    // modelo sem necessidade é vender caro, descer é não proteger.
    const naFaixa = candidatos.filter(
      (c) => corrente >= (c.correnteMinA ?? 0) && corrente <= (c.correnteMaxA ?? 0),
    );
    if (naFaixa.length > 0) {
      // 🔴 TODA faixa tem TRÊS produtos — o base, o `_D.S.` e o `_E.P.` dividem a
      // mesma corrente (conferido nos 36 do catálogo: 12 faixas, 3 SKUs cada).
      //
      // Antes daqui existir, o seletor fazia `find` e ficava com o primeiro que
      // o Postgres devolvesse: o rep podia receber `MB-04_E.P.` tendo pedido o
      // Master Block puro, ou o contrário, e nada acusava — os três são
      // equipamentos legítimos para aquela corrente, com preços bem diferentes
      // (MB-04 425, _E.P. 729, _D.S. 874 por mês).
      const escolhido = this.daVariante(naFaixa, variante);
      if (!escolhido) {
        this.logger.warn(
          `Corrente ${corrente}A: faixa existe, mas não há produto da variante ${variante} ` +
            `(candidatos: ${naFaixa.map((c) => c.sku).join(', ')}) — empresa ${empresaId}`,
        );
        return { ok: false, motivo: 'variante-indisponivel' };
      }
      return {
        ok: true,
        modelo: {
          produtoId: escolhido.id,
          sku: escolhido.sku ?? '',
          nome: escolhido.nome,
          correnteMinA: escolhido.correnteMinA ?? 0,
          correnteMaxA: escolhido.correnteMaxA ?? 0,
        },
      };
    }

    // Passou do teto da linha inteira — instalação grande demais pro catálogo.
    const teto = candidatos.reduce((max, c) => Math.max(max, c.correnteMaxA ?? 0), 0);
    if (corrente > teto) {
      this.logger.warn(
        `Corrente ${corrente}A acima da linha (teto ${teto}A) — empresa ${empresaId}`,
      );
      return { ok: false, motivo: 'acima-da-linha' };
    }

    // Sobrou buraco ENTRE faixas: não é instalação grande demais, é cadastro com
    // lacuna. Vale o aviso alto — a linha deveria ser contínua.
    this.logger.warn(
      `Corrente ${corrente}A não cai em nenhuma faixa, e está abaixo do teto ` +
        `(${teto}A) — há LACUNA no cadastro de faixas da empresa ${empresaId}`,
    );
    return { ok: false, motivo: 'sem-faixa-cadastrada' };
  }

  /**
   * Entre os produtos da MESMA faixa, o da variante pedida.
   *
   * ⚠️ `BASE` exige SKU sem sufixo NENHUM (`MB-04`), não "sem os sufixos que eu
   * conheço". A diferença aparece no dia em que entrar uma variante nova no
   * catálogo: com a regra fraca, `MB-04_X.Y.` seria servido calado como se
   * fosse o Master Block puro. Com esta, ele não casa com nada e o seletor
   * devolve `variante-indisponivel` — um erro visível, em vez de um
   * equipamento errado dentro de um contrato assinado.
   */
  private daVariante<T extends { sku: string | null }>(
    naFaixa: T[],
    variante: VarianteAcompanhamento,
  ): T | undefined {
    if (variante === 'BASE') {
      return naFaixa.find((c) => !!c.sku && !c.sku.includes('_'));
    }
    return naFaixa.find((c) => (c.sku ?? '').endsWith(SUFIXO[variante]));
  }
}
