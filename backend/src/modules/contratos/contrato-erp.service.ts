import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import {
  TinyContratosService,
  type NotaDoContratoErp,
  type TinyVencimento,
} from '@integrations/tiny/tiny-contratos.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

/** Bloco `Empresa.config.erp.contratoLocacao` — tudo opcional, tudo do tenant. */
interface ConfigContratoLocacao {
  vencimento?: TinyVencimento;
  emiteNota?: boolean;
  codigoListaServico?: string;
  naturezaOperacao?: string;
  percentualIss?: number;
  servicoCodigo?: string;
  servicoNome?: string;
}

export interface ResultadoContratoErp {
  contratoErpId: string;
  jaExistia: boolean;
}

/**
 * Sobe o contrato de locação assinado para o ERP como CONTRATO RECORRENTE.
 *
 * Locação não é pedido de venda: o que cobra todo mês é um contrato, e o objeto
 * de contrato só existe na API v2 do Tiny (ver `TinyV2ClientService`).
 *
 * Duas travas que valem mais que o resto do arquivo:
 *
 * 1. **Só sobe assinado.** Contrato no ERP sem assinatura é o erro caro deste
 *    fluxo — vira cobrança mensal de um documento que ninguém assinou, e a v2
 *    não tem DELETE pra desfazer (encerra-se por mês/ano de término).
 * 2. **Idempotente pelo `contratoErpId`.** Subir duas vezes é duas cobranças
 *    mensais no mesmo cliente, e a segunda ninguém percebe até o financeiro.
 */
@Injectable()
export class ContratoErpService {
  private readonly logger = new Logger(ContratoErpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contratos: TinyContratosService,
  ) {}

  async enviar(contratoId: string, empresaId: string): Promise<ResultadoContratoErp> {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id: contratoId, empresaId },
      include: {
        cliente: { select: { nome: true, cnpj: true } },
        proposta: { select: { numero: true } },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato não encontrado', ErrorCode.NOT_FOUND);

    if (contrato.contratoErpId) {
      return { contratoErpId: contrato.contratoErpId, jaExistia: true };
    }
    if (contrato.status !== 'ASSINADO' && contrato.status !== 'ATIVO') {
      throw new BusinessRuleException(
        `Contrato ainda não assinado (${contrato.status}). O ERP só recebe contrato assinado — ` +
          `lá ele vira cobrança mensal, e não há como excluir depois.`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    if (!contrato.cliente.cnpj) {
      // Sem documento o Tiny não acha o contato existente e cria OUTRO com o
      // mesmo nome — daí o contrato cobra um cadastro que não é o do cliente.
      throw new BusinessRuleException(
        'Cliente sem CNPJ/CPF: o ERP amarraria o contrato a um contato novo em vez do cadastro real.',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    if (!this.contratos.configurado) {
      throw new BusinessRuleException(
        'Integração de contrato desligada (TINY_V2_TOKEN ausente).',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    const cfg = await this.config(empresaId);
    // O ciclo começa quando a cobrança começa: `primeiraCobrancaEm` já é a data
    // DEPOIS da carência (quem a preenche é o comodato, na saída da NF). Sem
    // ela, o ciclo começa na assinatura.
    const inicio = contrato.primeiraCobrancaEm ?? contrato.assinadoEm ?? new Date();

    const { id } = await this.contratos.incluir({
      inicio,
      descricao: `Locação Master Block — ${contrato.proposta.numero}`,
      cliente: { nome: contrato.cliente.nome, cpfCnpj: contrato.cliente.cnpj },
      valorMensal: Number(contrato.valorMensal),
      diaVencimento: contrato.diaVencimento,
      prazoMeses: contrato.prazoMeses,
      vencimento: cfg.vencimento,
      observacao: `Contrato ${contrato.id} · proposta ${contrato.proposta.numero} (Betinna)`,
      nota: this.nota(cfg),
    });

    await this.prisma.contrato.update({
      where: { id: contrato.id },
      data: { contratoErpId: id, enviadoErpEm: new Date(), status: 'ATIVO' },
    });
    this.logger.log(
      `Contrato ${contrato.id} (${contrato.proposta.numero}) no ERP como ${id} — ` +
        `R$ ${Number(contrato.valorMensal).toFixed(2)}/mês por ${contrato.prazoMeses} meses`,
    );
    return { contratoErpId: id, jaExistia: false };
  }

  /**
   * Nota de serviço só sai com os dados fiscais que o tenant cadastrou.
   *
   * Código de lista de serviço, natureza da operação e ISS são decisão da
   * CONTABILIDADE da empresa — default nosso viraria imposto errado numa NFS-e
   * de verdade. Faltando qualquer um, o contrato entra sem emitir nota (a
   * cobrança acontece igual) e o log diz o que falta.
   */
  private nota(cfg: ConfigContratoLocacao): NotaDoContratoErp | null {
    if (!cfg.emiteNota) return null;
    const faltando = (
      [
        'codigoListaServico',
        'naturezaOperacao',
        'percentualIss',
        'servicoCodigo',
        'servicoNome',
      ] as const
    ).filter((k) => cfg[k] === undefined || cfg[k] === null || cfg[k] === '');
    if (faltando.length > 0) {
      this.logger.warn(
        `Emissão de nota do contrato pedida, mas faltam dados fiscais (${faltando.join(', ')}) — ` +
          `contrato vai SEM nota. Complete em Empresa → config.erp.contratoLocacao.`,
      );
      return null;
    }
    return {
      codigoListaServico: cfg.codigoListaServico!,
      naturezaOperacao: cfg.naturezaOperacao!,
      percentualIss: cfg.percentualIss!,
      servicoCodigo: cfg.servicoCodigo!,
      servicoNome: cfg.servicoNome!,
    };
  }

  private async config(empresaId: string): Promise<ConfigContratoLocacao> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const erp = ((empresa?.config as Record<string, unknown> | null)?.erp ?? {}) as {
      contratoLocacao?: ConfigContratoLocacao;
    };
    return erp.contratoLocacao ?? {};
  }
}
