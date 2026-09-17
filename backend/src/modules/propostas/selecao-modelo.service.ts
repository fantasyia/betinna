import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';

/** O que o levantamento de campo mediu num quadro. */
export interface Medicao {
  /** Corrente de carga, em ampères. É ela que decide o modelo. */
  correnteA: number;
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
    | { ok: false; motivo: 'corrente-invalida' | 'acima-da-linha' | 'sem-faixa-cadastrada' }
  > {
    const corrente = Math.trunc(Number(medicao.correnteA));
    if (!Number.isFinite(corrente) || corrente <= 0) {
      return { ok: false, motivo: 'corrente-invalida' };
    }

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

    // A faixa que CONTÉM a corrente. Ordenado por `correnteMinA`, o primeiro que
    // contém é o menor que atende — e o menor que atende é o certo: subir de
    // modelo sem necessidade é vender caro, descer é não proteger.
    const dentro = candidatos.find(
      (c) => corrente >= (c.correnteMinA ?? 0) && corrente <= (c.correnteMaxA ?? 0),
    );
    if (dentro) {
      return {
        ok: true,
        modelo: {
          produtoId: dentro.id,
          sku: dentro.sku ?? '',
          nome: dentro.nome,
          correnteMinA: dentro.correnteMinA ?? 0,
          correnteMaxA: dentro.correnteMaxA ?? 0,
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
}
