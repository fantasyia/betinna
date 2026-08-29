import { Injectable, Logger } from '@nestjs/common';
import { TinyClientService } from './tiny-client.service';
import { TinyContatosService } from './tiny-contatos.service';
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
  cliente: { nome: string; cpfCnpj?: string; email?: string; telefone?: string };
  itens: ItemOrcamentoTiny[];
  vendedorId?: number;
  /** Dias de validade da proposta (o Tiny conta a partir da data). */
  validadeDias?: number;
  dataPrevistaEntrega?: string;
  condicaoPagamento?: string;
  observacao?: string;
  /** Desconto em VALOR (o Tiny não aceita % no orçamento). */
  desconto?: number;
}

export interface ResultadoOrcamento {
  id: number;
  numeroProposta?: string;
}

/**
 * Propostas comerciais (orçamentos) no Tiny.
 *
 * A proposta já existia só no Betinna — o cliente recebia PDF daqui e, quando
 * aceitava, alguém redigitava o pedido no ERP. Subir a proposta faz o ERP ser
 * dono do ciclo inteiro: o orçamento vira pedido lá com **um** clique
 * (`/orcamentos/{id}/gerar-pedido`), sem redigitação e sem o pedido nascer com
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
      ...(orcamento.condicaoPagamento
        ? {
            condicoesComerciais: {
              tipo: 'Texto livre',
              textoLivre: orcamento.condicaoPagamento,
            },
          }
        : {}),
      ...(orcamento.observacao ? { observacao: orcamento.observacao } : {}),
      ...(orcamento.desconto ? { extras: { desconto: orcamento.desconto } } : {}),
    };

    const r = await this.client.post<ResultadoOrcamento>(empresaId, '/orcamentos', corpo);
    this.logger.log(
      `[tiny] orçamento criado id=${r?.id} numero=${r?.numeroProposta ?? '?'} ` +
        `(${itens.length} item(ns))`,
    );
    return r;
  }

  /**
   * Transforma o orçamento em PEDIDO dentro do Tiny.
   *
   * É a única forma de o pedido herdar o que o cliente aprovou — recriar o
   * pedido do zero perde o vínculo e deixa dois documentos que ninguém garante
   * serem iguais.
   */
  async gerarPedido(empresaId: string, idOrcamento: number): Promise<{ id: number }> {
    return this.client.post<{ id: number }>(
      empresaId,
      `/orcamentos/${idOrcamento}/gerar-pedido`,
      {},
    );
  }

  obter(empresaId: string, idOrcamento: number): Promise<Record<string, unknown>> {
    return this.client.get(empresaId, `/orcamentos/${idOrcamento}`);
  }
}
