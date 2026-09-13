import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyNotasService } from '@integrations/tiny/tiny-notas.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ContratoComodatoService } from './contrato-comodato.service';

export interface ResultadoComodato {
  notaId: string;
  numero?: string;
  chaveAcesso?: string;
  jaExistia: boolean;
}

interface ConfigComodato {
  emiteNota?: boolean | null;
  naturezaMesmaUf?: string | null;
  naturezaOutraUf?: string | null;
  idNaturezaMesmaUf?: number | null;
  idNaturezaOutraUf?: number | null;
}

/**
 * Emite a NF de COMODATO — a remessa que tira o equipamento da empresa.
 *
 * **Sai SEMPRE do pedido de venda** (decisão do Léo, 12/09). Nunca avulsa: nota
 * solta perde o vínculo que o ERP usa pra estoque, financeiro e histórico, e
 * ninguém consegue responder de qual venda a remessa saiu.
 *
 * **Disparo é MANUAL**, também por decisão dele: nota fiscal não tem desfazer
 * pela API do Tiny — não existe segunda nota pro mesmo pedido, não existe
 * endpoint de alterar, e rejeitada guarda um snapshot do item que corrigir o
 * cadastro não conserta. Um humano no gatilho é a última rede antes de um
 * documento fiscal existir no mundo.
 *
 * 🔴 **Toda guarda aqui recusa ANTES de chamar o ERP.** É de propósito: o custo
 * de recusar é alguém preencher um campo; o de emitir errado é uma nota que só
 * o painel desfaz — e nem sempre desfaz.
 */
@Injectable()
export class ContratoComodatoErpService {
  private readonly logger = new Logger(ContratoComodatoErpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notas: TinyNotasService,
    private readonly comodato: ContratoComodatoService,
  ) {}

  async emitir(contratoId: string, empresaId: string): Promise<ResultadoComodato> {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id: contratoId, empresaId },
      include: {
        cliente: { select: { nome: true, uf: true } },
        proposta: { select: { id: true, numero: true, pedidoErpId: true, modalidade: true } },
      },
    });
    if (!contrato) throw new BusinessRuleException('Contrato não encontrado');

    // Idempotência primeiro: nota não tem desfazer, e webhook/clique repetido
    // não pode virar segunda remessa do mesmo equipamento.
    if (contrato.comodatoNotaId) {
      return {
        notaId: contrato.comodatoNotaId,
        numero: contrato.comodatoNotaNumero ?? undefined,
        jaExistia: true,
      };
    }
    if (contrato.status !== 'ASSINADO' && contrato.status !== 'ATIVO') {
      throw new BusinessRuleException(
        `Contrato ${contrato.status} — a remessa em comodato sai depois da assinatura. ` +
          'Emitir antes tira o equipamento da empresa por um contrato que ninguém assinou.',
      );
    }
    if (contrato.proposta.modalidade !== 'LOCACAO') {
      throw new BusinessRuleException('Comodato é da LOCAÇÃO — venda não tem remessa em comodato.');
    }
    // É o pedido de VENDA no ERP que vira nota. Sem ele não há de onde emitir —
    // e criar um aqui seria a nota avulsa que o Léo descartou.
    if (!contrato.proposta.pedidoErpId) {
      throw new BusinessRuleException(
        `Proposta ${contrato.proposta.numero} ainda não tem pedido de venda no ERP. ` +
          'A NF de comodato sai do pedido: gere o pedido antes (orçamento → pedido de venda).',
      );
    }

    const cfg = await this.config(empresaId);
    if (!cfg.emiteNota) {
      throw new BusinessRuleException(
        'Emissão de comodato está DESLIGADA para esta empresa. ' +
          'Ligue em Empresa → config.erp.comodato quando a contabilidade definir a natureza da operação.',
      );
    }
    const natureza = await this.natureza(empresaId, contrato.cliente.uf, cfg);

    const gerada = await this.notas.gerarDoPedido(contrato.proposta.pedidoErpId, natureza);
    // Grava ANTES de autorizar: a nota já existe no ERP neste ponto. Se a
    // autorização falhar (ou o processo cair), o id guardado é o que impede a
    // próxima tentativa de gerar uma SEGUNDA nota pro mesmo pedido.
    await this.prisma.contrato.update({
      where: { id: contrato.id },
      data: { comodatoNotaId: gerada.id, comodatoNotaNumero: gerada.numero ?? null },
    });

    const autorizada = await this.notas.emitirEEsperar(gerada.id);
    await this.prisma.contrato.update({
      where: { id: contrato.id },
      data: {
        comodatoNotaNumero: autorizada.numero ?? gerada.numero ?? null,
        comodatoEmitidaEm: new Date(),
      },
    });

    // A mensalidade começa a contar da NF de comodato (regra do Léo, 05/09) —
    // antes disso o equipamento nem saiu da empresa.
    await this.comodato
      .iniciarCobrancaPorContrato(contrato.id, autorizada.dataEmissao ?? null)
      .catch((err: unknown) =>
        this.logger.warn(
          `Nota ${gerada.id} emitida, mas o início da cobrança não foi marcado: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    this.logger.log(
      `Comodato do contrato ${contrato.id} (${contrato.proposta.numero}): nota ${autorizada.numero ?? gerada.id} autorizada`,
    );
    return {
      notaId: gerada.id,
      numero: autorizada.numero ?? gerada.numero,
      chaveAcesso: autorizada.chaveAcesso,
      jaExistia: false,
    };
  }

  private async config(empresaId: string): Promise<ConfigComodato> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const erp = ((empresa?.config as Record<string, unknown> | null)?.erp ?? {}) as {
      comodato?: ConfigComodato;
    };
    return erp.comodato ?? {};
  }

  /**
   * Qual natureza de operação usar — e é aqui que a UF importa.
   *
   * ⚠️ O CFOP da remessa muda entre operação interna e interestadual, e a API
   * **não aceita CFOP**: ele mora na natureza cadastrada no painel do Tiny. Por
   * isso são duas, e escolher a errada declara a operação errada numa nota que
   * não se corrige depois.
   *
   * Sem a UF de um dos lados o app RECUSA em vez de chutar a interna: "mesma
   * UF" é o palpite mais provável e o mais caro, porque uma remessa
   * interestadual com CFOP interno passa despercebida até a fiscalização.
   */
  private async natureza(
    empresaId: string,
    ufCliente: string | null,
    cfg: ConfigComodato,
  ): Promise<{ naturezaOperacao?: string; idNaturezaOperacao?: number }> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { uf: true },
    });
    const ufEmpresa = (empresa?.uf ?? '').trim().toUpperCase();
    const ufDestino = (ufCliente ?? '').trim().toUpperCase();
    if (!ufEmpresa || !ufDestino) {
      throw new BusinessRuleException(
        'Falta a UF da empresa e/ou do cliente — sem elas não dá pra saber se a remessa é ' +
          'interna ou interestadual, e o CFOP das duas é diferente.',
      );
    }

    const mesmaUf = ufEmpresa === ufDestino;
    const nome = mesmaUf ? cfg.naturezaMesmaUf : cfg.naturezaOutraUf;
    const id = mesmaUf ? cfg.idNaturezaMesmaUf : cfg.idNaturezaOutraUf;
    if (!nome && !id) {
      throw new BusinessRuleException(
        `Falta a natureza de operação da remessa ${mesmaUf ? `dentro de ${ufEmpresa}` : `de ${ufEmpresa} para ${ufDestino}`}. ` +
          'Configure em Empresa → config.erp.comodato (é ela que carrega o CFOP).',
      );
    }
    return {
      ...(nome ? { naturezaOperacao: nome } : {}),
      ...(id ? { idNaturezaOperacao: id } : {}),
    };
  }
}
