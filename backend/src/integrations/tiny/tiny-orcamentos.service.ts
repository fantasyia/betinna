import { Injectable, Logger } from '@nestjs/common';
import { TinyClientService } from './tiny-client.service';
import { TinyContatosService, type EnderecoParaTiny } from './tiny-contatos.service';
import { TinyPedidosService } from './tiny-pedidos.service';

export interface ItemOrcamentoTiny {
  /** SKU — a chave que amarra site ↔ ERP ↔ app. */
  sku: string;
  quantidade: number;
  valorUnitario: number;
  /** Texto extra que aparece embaixo do item na proposta impressa. */
  descricaoComplementar?: string;
}

export interface OrcamentoParaTiny {
  cliente: {
    nome: string;
    cpfCnpj?: string;
    email?: string;
    telefone?: string;
    /** Sem endereço no contato, o ERP não cota frete nem emite etiqueta. */
    endereco?: EnderecoParaTiny;
  };
  itens: ItemOrcamentoTiny[];
  vendedorId?: number;
  /** Dias de validade da proposta (o Tiny conta a partir da data). */
  validadeDias?: number;
  dataPrevistaEntrega?: string;
  /**
   * Condição de pagamento em texto ("30/60"). Vai dentro da OBSERVAÇÃO.
   *
   * O bloco `condicoesComerciais` do Tiny foi tentado e recusado nas duas
   * formas documentadas — com `tipo: 'Texto livre'` ele responde "Texto livre
   * não pode ser preenchido sem especificar o tipo", e com `tipo: 'Parcelas'`,
   * "Parcelas não podem ser preenchidas sem especificar o tipo". O par
   * tipo+conteúdo é recusado mesmo escrito como a documentação manda. Como a
   * condição definitiva é acertada na aprovação, dentro do ERP, ela viaja como
   * texto na observação — que aparece na proposta impressa do mesmo jeito.
   */
  condicaoPagamento?: string;
  observacao?: string;
  /** Desconto em VALOR (o Tiny não aceita % no orçamento). */
  desconto?: number;
}

export interface ResultadoOrcamento {
  id: number;
  numeroProposta?: string;
}

/** O que o Tiny devolve ao transformar o orçamento em pedido de venda. */
export interface ResultadoVenda {
  id: number;
  numeroPedido?: string;
}

/**
 * Propostas comerciais (orçamentos) no Tiny.
 *
 * A proposta já existia só no Betinna — o cliente recebia PDF daqui e, quando
 * aceitava, alguém redigitava o pedido no ERP. Subir a proposta faz o ERP ser
 * dono do ciclo inteiro: o orçamento vira pedido lá com **uma** chamada
 * (`POST /orcamentos/{id}/venda`), sem redigitação e sem o pedido nascer com
 * valores diferentes dos que o cliente aprovou.
 *
 * **Duas diferenças em relação ao pedido**, ambas do contrato da API:
 *  - o item vai com `produto.id` (o SKU não é aceito aqui) — por isso a busca
 *    por SKU é a mesma do pedido, reusada, e não uma segunda cópia da regra;
 *  - `vendedor.id` é OBRIGATÓRIO. Sem vendedor o Tiny recusa o orçamento
 *    inteiro; no pedido ele aceita e o registro nasce órfão.
 */
@Injectable()
export class TinyOrcamentosService {
  private readonly logger = new Logger(TinyOrcamentosService.name);

  constructor(
    private readonly client: TinyClientService,
    private readonly contatos: TinyContatosService,
    private readonly pedidos: TinyPedidosService,
  ) {}

  async criar(empresaId: string, orcamento: OrcamentoParaTiny): Promise<ResultadoOrcamento> {
    const itens = [];
    for (const item of orcamento.itens) {
      const produto = await this.pedidos.acharPorSku(empresaId, item.sku);
      if (!produto) {
        throw new Error(
          `SKU ${item.sku} não existe no Tiny — orçamento NÃO criado (proposta com item ` +
            'faltando vira pedido errado quando o cliente aprovar)',
        );
      }
      itens.push({
        produto: { id: produto.id },
        quantidade: item.quantidade,
        // A API do orçamento pede o unitário como STRING (o do pedido é
        // número). Mandar número aqui volta 400 sem dizer qual campo.
        valorUnitario: item.valorUnitario.toFixed(2),
        ...(item.descricaoComplementar ? { descrComplementarOrc: item.descricaoComplementar } : {}),
      });
    }

    const idContato = await this.contatos.garantir(empresaId, orcamento.cliente);

    const corpo: Record<string, unknown> = {
      contato: { id: idContato },
      itens,
      ...(orcamento.vendedorId ? { vendedor: { id: orcamento.vendedorId } } : {}),
      ...(orcamento.validadeDias || orcamento.dataPrevistaEntrega
        ? {
            condicoesGerais: {
              ...(orcamento.validadeDias ? { validade: orcamento.validadeDias } : {}),
              ...(orcamento.dataPrevistaEntrega
                ? { dataPrevistaEntrega: orcamento.dataPrevistaEntrega }
                : {}),
            },
          }
        : {}),
      ...(this.observacaoFinal(orcamento) ? { observacao: this.observacaoFinal(orcamento) } : {}),
      ...(orcamento.desconto ? { extras: { desconto: orcamento.desconto } } : {}),
    };

    const r = await this.client.post<ResultadoOrcamento>(empresaId, '/orcamentos', corpo);
    this.logger.log(
      `[tiny] orçamento criado id=${r?.id} numero=${r?.numeroProposta ?? '?'} ` +
        `(${itens.length} item(ns))`,
    );
    return r;
  }

  /** Junta observação e condição de pagamento — ver o comentário do campo. */
  private observacaoFinal(orcamento: OrcamentoParaTiny): string {
    return [
      orcamento.observacao,
      orcamento.condicaoPagamento ? `Pagamento: ${orcamento.condicaoPagamento}` : '',
    ]
      .filter(Boolean)
      .join(' — ');
  }

  obter(empresaId: string, idOrcamento: number): Promise<Record<string, unknown>> {
    return this.client.get(empresaId, `/orcamentos/${idOrcamento}`);
  }

  /**
   * Orçamento aprovado → PEDIDO DE VENDA, dentro do próprio Tiny.
   *
   * É o passo que fechava o ciclo à mão: alguém abria o orçamento aprovado e
   * relançava os itens como pedido. Relançar é onde o valor diverge do que o
   * cliente aprovou — e a divergência só aparece na nota.
   *
   * O Tiny copia itens, contato, vendedor e condições do orçamento; por isso o
   * corpo é VAZIO (a spec não declara requestBody). Mandar um corpo aqui não
   * "melhora" nada: campo desconhecido o Tiny ignora em silêncio, e a
   * expectativa de que ele foi aplicado é o que engana depois.
   *
   * ⚠️ Não é idempotente do lado do Tiny: chamar duas vezes gera DOIS pedidos
   * pro mesmo orçamento. Quem chama tem que travar antes (é o que o
   * `PropostaErpService` faz, guardando o id do pedido gerado).
   */
  async gerarVenda(empresaId: string, idOrcamento: number): Promise<ResultadoVenda> {
    const r = await this.client.post<ResultadoVenda>(
      empresaId,
      `/orcamentos/${idOrcamento}/venda`,
      {},
    );
    this.logger.log(
      `[tiny] orçamento ${idOrcamento} virou pedido id=${r?.id} numero=${r?.numeroPedido ?? '?'}`,
    );
    return r;
  }
}
