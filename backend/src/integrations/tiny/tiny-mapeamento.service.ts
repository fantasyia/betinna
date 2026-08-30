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
 * Contrato (API 2.0 — "Webhooks envio de produtos"):
 *   { mapeamentos: [ { mapeamento: { idMapeamento, skuMapeamento,
 *                                    urlProduto?, urlImagem?, error? } } ] }
 *
 *   idMapeamento  — id do produto/variação NA OLIST (devolvemos o que veio)
 *   skuMapeamento — como a NOSSA loja identifica o produto
 */
export interface Mapeamento {
  idMapeamento: number;
  skuMapeamento?: string;
  urlProduto?: string;
  urlImagem?: string;
  error?: string;
}

export interface RespostaMapeamento {
  mapeamentos: Array<{ mapeamento: Mapeamento }>;
}

interface ProdutoDoErp {
  id?: number | string;
  idProduto?: number | string;
  sku?: string;
  codigo?: string;
  descricao?: string;
  variacoes?: ProdutoDoErp[];
}

interface PayloadProduto {
  cnpj?: string;
  dados?: ProdutoDoErp | ProdutoDoErp[];
}

@Injectable()
export class TinyMapeamentoService {
  private readonly logger = new Logger(TinyMapeamentoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async responder(bruto: string): Promise<RespostaMapeamento> {
    let payload: PayloadProduto;
    try {
      payload = JSON.parse(bruto) as PayloadProduto;
    } catch {
      this.logger.warn('[tiny] envio de produto com corpo ilegível');
      return { mapeamentos: [] };
    }

    const itens = this.achatar(payload.dados);
    if (itens.length === 0) return { mapeamentos: [] };

    const empresaId = await this.empresaDoEvento(payload.cnpj);
    // Sem tenant resolvido, o `sku` que o próprio ERP mandou ainda serve: os
    // dois lados usam o mesmo código (MB-01). O que NÃO vale é inventar.
    const porCodigoErp = empresaId ? await this.catalogo(empresaId, itens) : new Map();

    const mapeamentos = itens.map((item) => {
      const id = Number(item.id ?? item.idProduto);
      if (!Number.isFinite(id) || id <= 0) {
        return { mapeamento: { idMapeamento: 0, error: 'produto sem id no envio' } };
      }

      const sku = porCodigoErp.get(String(id)) ?? item.sku ?? item.codigo;
      if (!sku) {
        // Dizer o motivo é melhor que sumir com o item: o painel do ERP mostra
        // esta mensagem pra quem clicou em "enviar".
        return {
          mapeamento: {
            idMapeamento: id,
            error: `produto ${item.descricao ?? id} não existe no catálogo do site`,
          },
        };
      }
      return { mapeamento: { idMapeamento: id, skuMapeamento: String(sku) } };
    });

    const ok = mapeamentos.filter((m) => m.mapeamento.skuMapeamento).length;
    this.logger.log(`[tiny] envio de produto: ${ok}/${mapeamentos.length} mapeado(s)`);
    return { mapeamentos };
  }

  /** O envio pode trazer um produto, vários, e variações dentro deles. */
  private achatar(dados: PayloadProduto['dados']): ProdutoDoErp[] {
    const lista = Array.isArray(dados) ? dados : dados ? [dados] : [];
    return lista.flatMap((p) => [p, ...(p.variacoes ?? [])]);
  }

  /** codigoErp → sku do nosso catálogo, numa consulta só. */
  private async catalogo(empresaId: string, itens: ProdutoDoErp[]): Promise<Map<string, string>> {
    const ids = itens.map((i) => String(i.id ?? i.idProduto ?? '')).filter((s) => s.length > 0);
    if (ids.length === 0) return new Map();

    const produtos = await this.prisma.produto.findMany({
      where: { empresaId, codigoErp: { in: ids } },
      select: { codigoErp: true, sku: true },
    });
    return new Map(
      produtos.filter((p) => p.codigoErp && p.sku).map((p) => [String(p.codigoErp), String(p.sku)]),
    );
  }

  /**
   * Mesma regra do processador: CNPJ manda; sem ele, cai pra ÚNICA conexão
   * ativa. Com duas empresas conectadas, adivinhar seria responder o
   * mapeamento de outro tenant.
   */
  private async empresaDoEvento(cnpjBruto?: string): Promise<string | null> {
    const cnpj = (cnpjBruto ?? '').replace(/\D/g, '');
    if (cnpj) {
      const empresas = await this.prisma.empresa.findMany({ select: { id: true, cnpj: true } });
      return empresas.find((e) => (e.cnpj ?? '').replace(/\D/g, '') === cnpj)?.id ?? null;
    }
    const conexoes = await this.prisma.integracaoConexao.findMany({
      where: { servico: 'tiny', ativo: true },
      select: { empresaId: true },
      take: 2,
    });
    return conexoes.length === 1 ? conexoes[0].empresaId : null;
  }
}
