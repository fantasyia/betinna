import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';

/**
 * A resposta que o ERP espera quando ENVIA um produto pro e-commerce.
 *
 * Aqui o webhook não é aviso, é **pergunta**: "este produto meu, como a sua
 * loja chama?". Responder só `200 ok` faz o ERP marcar o envio como
 * "Produto não mapeado pelo integrador" — e sem mapeamento o produto não entra
 * na lista do canal, que é justamente onde a cotação de frete procura o item.
 *
 * Contrato conferido nos arquivos de exemplo da própria Olist
 * (`api-docs/files/webhook-produto.json` e `-retorno.json`), porque a página
 * não transcreve o JSON — e três detalhes só aparecem lá:
 *
 *  1. **A resposta é um ARRAY PURO**, não um objeto com chave.
 *  2. **`idMapeamento` NÃO é o id do produto.** O envio traz os dois lado a
 *     lado (`"id": "441393295"`, `"idMapeamento": "1304432"`); o que volta é o
 *     segundo. Devolver o id do produto é aceito com 200 e ignorado — o painel
 *     segue dizendo "não mapeado", sem dizer por quê.
 *  3. **O produto vem na RAIZ do corpo**, não dentro de `dados`. As variações
 *     vêm em `variacoes[]`, cada uma com o próprio `idMapeamento`.
 *
 * Os ids são STRING no contrato. Mantemos string: converter pra número e voltar
 * é chance de perder zero à esquerda por nada.
 */
export interface Mapeamento {
  idMapeamento: string;
  skuMapeamento?: string;
  urlProduto?: string;
  urlImagem?: string;
  error?: string;
}

interface ProdutoDoErp {
  /** Id do PRODUTO no ERP. Serve pra casar com o nosso catálogo, não pra voltar. */
  id?: string | number;
  /** Id do MAPEAMENTO. É este que volta na resposta. */
  idMapeamento?: string | number;
  /** Código do produto no ERP (no nosso caso, "MB-01"). */
  codigo?: string;
  nome?: string;
  variacoes?: ProdutoDoErp[];
}

@Injectable()
export class TinyMapeamentoService {
  private readonly logger = new Logger(TinyMapeamentoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async responder(bruto: string): Promise<Mapeamento[]> {
    let corpo: unknown;
    try {
      corpo = JSON.parse(bruto);
    } catch {
      this.logger.warn('[tiny] envio de produto com corpo ilegível');
      return [];
    }

    const itens = this.achatar(corpo);
    if (itens.length === 0) {
      this.logger.warn('[tiny] envio de produto sem nenhum item reconhecível');
      return [];
    }

    const porCodigoErp = await this.catalogo(itens);

    const resposta = itens.map((item): Mapeamento => {
      const idMapeamento = String(item.idMapeamento ?? '').trim();
      if (!idMapeamento) {
        // Sem o id do mapeamento não há o que responder: é a chave da linha
        // que o ERP quer preencher.
        return { idMapeamento: '', error: 'envio sem idMapeamento' };
      }

      const sku = porCodigoErp.get(String(item.id ?? '')) ?? item.codigo;
      if (!sku) {
        // Dizer o motivo é melhor que sumir com o item: o painel do ERP mostra
        // esta mensagem pra quem clicou em "enviar".
        return {
          idMapeamento,
          error: `produto ${item.nome ?? item.id ?? ''} não existe no catálogo do site`.trim(),
        };
      }
      return { idMapeamento, skuMapeamento: String(sku) };
    });

    const ok = resposta.filter((m) => m.skuMapeamento).length;
    this.logger.log(`[tiny] envio de produto: ${ok}/${resposta.length} mapeado(s)`);
    return resposta;
  }

  /** Produto na raiz (ou lista deles), com as variações viradas em itens. */
  private achatar(corpo: unknown): ProdutoDoErp[] {
    if (!corpo || typeof corpo !== 'object') return [];
    const lista = Array.isArray(corpo) ? (corpo as ProdutoDoErp[]) : [corpo as ProdutoDoErp];
    return lista
      .filter((p) => p && typeof p === 'object')
      .flatMap((p) => [p, ...(Array.isArray(p.variacoes) ? p.variacoes : [])]);
  }

  /**
   * `codigoErp` → sku do nosso catálogo, numa consulta só.
   *
   * O envio não traz CNPJ, então o tenant sai da ÚNICA conexão Tiny ativa. Com
   * duas empresas conectadas isso fica ambíguo e a consulta é pulada — melhor
   * cair no `codigo` do próprio envio do que responder o SKU do tenant errado.
   */
  private async catalogo(itens: ProdutoDoErp[]): Promise<Map<string, string>> {
    const ids = itens.map((i) => String(i.id ?? '')).filter((s) => s.length > 0);
    if (ids.length === 0) return new Map();

    const conexoes = await this.prisma.integracaoConexao.findMany({
      where: { servico: 'tiny', ativo: true },
      select: { empresaId: true },
      take: 2,
    });
    if (conexoes.length !== 1) return new Map();

    const produtos = await this.prisma.produto.findMany({
      where: { empresaId: conexoes[0].empresaId, codigoErp: { in: ids } },
      select: { codigoErp: true, sku: true },
    });
    return new Map(
      produtos.filter((p) => p.codigoErp && p.sku).map((p) => [String(p.codigoErp), String(p.sku)]),
    );
  }
}
