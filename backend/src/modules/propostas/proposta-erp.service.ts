import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyOrcamentosService } from '@integrations/tiny/tiny-orcamentos.service';
import { TinyContatosService } from '@integrations/tiny/tiny-contatos.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

export interface ResultadoPropostaErp {
  propostaId: string;
  orcamentoErpId: string;
  numeroProposta?: string;
  /** Vendedor casado no ERP; ausente = subiu sem vendedor (e o Tiny recusa). */
  vendedorErpId?: number;
}

/**
 * Sobe a proposta comercial do app como ORÇAMENTO no ERP.
 *
 * O ciclo que isto fecha: o rep monta a proposta aqui, o cliente aprova, e o
 * pedido nasce no ERP **a partir do orçamento aprovado** — não redigitado. Sem
 * isso, alguém relança à mão e o pedido pode sair com valor diferente do que o
 * cliente assinou.
 *
 * **O vendedor é obrigatório no orçamento** (diferente do pedido, que aceita
 * sem). Então aqui a falta de vendedor é erro explicado, não um 400 cru do
 * Tiny: o rep precisa existir como contato (rodada diária) e estar marcado como
 * vendedor no painel.
 */
@Injectable()
export class PropostaErpService {
  private readonly logger = new Logger(PropostaErpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orcamentos: TinyOrcamentosService,
    private readonly contatos: TinyContatosService,
  ) {}

  async enviar(propostaId: string, empresaId: string): Promise<ResultadoPropostaErp> {
    const proposta = await this.prisma.proposta.findFirst({
      where: { id: propostaId, empresaId },
      include: {
        cliente: true,
        itens: true,
        representante: { select: { nome: true, contatoErpId: true } },
      },
    });
    if (!proposta) throw new BusinessRuleException('Proposta não encontrada');
    if (proposta.orcamentoErpId) {
      // Reenviar criaria um segundo orçamento pro mesmo negócio, e o cliente
      // receberia duas propostas com números diferentes.
      throw new BusinessRuleException(
        `Proposta já está no ERP (orçamento ${proposta.orcamentoErpId})`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    if (proposta.status === 'RASCUNHO') {
      throw new BusinessRuleException(
        'Proposta em rascunho — envie ou aprove antes de subir ao ERP',
      );
    }

    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: proposta.itens.map((i) => i.produtoId) } },
      select: { id: true, sku: true, nome: true },
    });
    const skuPorProduto = new Map(produtos.map((p) => [p.id, p.sku]));
    const semSku = proposta.itens.filter((i) => !skuPorProduto.get(i.produtoId));
    if (semSku.length > 0) {
      throw new BusinessRuleException(
        `Produto sem SKU na proposta (${semSku.map((i) => i.produtoNome).join(', ')}) — ` +
          'o SKU é o que amarra o item ao ERP.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    const vendedorErpId = await this.resolverVendedor(empresaId, proposta.representante);

    const r = await this.orcamentos.criar(empresaId, {
      cliente: {
        nome: proposta.cliente.nome,
        cpfCnpj: proposta.cliente.cnpj ?? undefined,
        email: proposta.cliente.email ?? undefined,
        telefone: proposta.cliente.telefone ?? undefined,
      },
      itens: proposta.itens.map((i) => ({
        sku: skuPorProduto.get(i.produtoId)!,
        quantidade: i.quantidade,
        // O unitário JÁ com o desconto do item: é o preço que o cliente leu na
        // proposta. Mandar o cheio e o desconto separado faria o total do ERP
        // divergir do PDF que ele aprovou.
        valorUnitario: Number(i.total) / Math.max(1, i.quantidade),
      })),
      ...(vendedorErpId ? { vendedorId: vendedorErpId } : {}),
      ...(proposta.validoAte ? { validadeDias: this.diasAte(proposta.validoAte) } : {}),
      ...(proposta.prazoEntrega
        ? { dataPrevistaEntrega: proposta.prazoEntrega.toISOString().slice(0, 10) }
        : {}),
      ...(proposta.condicaoPagamento ? { condicaoPagamento: proposta.condicaoPagamento } : {}),
      observacao: [`Proposta ${proposta.numero} (Betinna)`, proposta.observacoes ?? '']
        .filter(Boolean)
        .join(' — '),
    });

    await this.prisma.proposta.update({
      where: { id: proposta.id },
      data: { orcamentoErpId: String(r.id), enviadaErpEm: new Date() },
    });

    this.logger.log(
      `Proposta ${proposta.numero} → orçamento Tiny ${r.numeroProposta ?? r.id} (id ${r.id})`,
    );
    return {
      propostaId: proposta.id,
      orcamentoErpId: String(r.id),
      numeroProposta: r.numeroProposta,
      ...(vendedorErpId ? { vendedorErpId } : {}),
    };
  }

  /**
   * Aprova o orçamento: ele vira PEDIDO no ERP.
   *
   * O pedido nasce do orçamento aprovado (endpoint do próprio Tiny), então
   * herda contato, itens, valores e vendedor — nada é redigitado. De lá ele
   * volta pro app pela sincronização, já com o representante casado, e é esse
   * pedido que vira comissão.
   */
  async aprovar(propostaId: string, empresaId: string): Promise<{ pedidoErpId: number }> {
    const proposta = await this.prisma.proposta.findFirst({
      where: { id: propostaId, empresaId },
      select: { id: true, numero: true, orcamentoErpId: true },
    });
    if (!proposta) throw new BusinessRuleException('Proposta não encontrada');
    if (!proposta.orcamentoErpId) {
      throw new BusinessRuleException(
        'Proposta ainda não subiu pro ERP — envie o orçamento antes de aprovar.',
      );
    }
    const r = await this.orcamentos.gerarPedido(empresaId, Number(proposta.orcamentoErpId));
    this.logger.log(
      `Orçamento ${proposta.orcamentoErpId} (proposta ${proposta.numero}) → pedido ERP ${r?.id}`,
    );
    return { pedidoErpId: r?.id };
  }

  private async resolverVendedor(
    empresaId: string,
    rep: { nome: string; contatoErpId: string | null } | null,
  ): Promise<number | undefined> {
    const contato = Number(rep?.contatoErpId ?? 0);
    if (!contato) {
      // Sem contato não há como haver vendedor. Dizer isso aqui poupa a caçada
      // ao 400 do Tiny, que só reclama de "vendedor" sem explicar a origem.
      throw new BusinessRuleException(
        rep
          ? `${rep.nome} ainda não é contato no ERP — o cadastro sobe na rodada diária ` +
              '(exige CPF/CNPJ no usuário).'
          : 'Proposta sem representante — o orçamento do Tiny exige vendedor.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const vendedor = await this.contatos.acharVendedorPorContato(empresaId, contato);
    if (!vendedor) {
      throw new BusinessRuleException(
        `${rep?.nome ?? 'O representante'} é contato no ERP mas ainda NÃO é vendedor — ` +
          'marque o papel em Cadastros → Vendedores no Tiny (a API só lê vendedores).',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return vendedor;
  }

  /** Validade em DIAS: é assim que o Tiny guarda, e é o que a proposta impressa mostra. */
  private diasAte(data: Date): number {
    const dia = 24 * 60 * 60 * 1000;
    return Math.max(1, Math.ceil((data.getTime() - Date.now()) / dia));
  }
}
