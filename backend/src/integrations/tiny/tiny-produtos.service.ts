import { Injectable, Logger } from '@nestjs/common';
import { TinyClientService } from './tiny-client.service';

/** O que o Tiny aceita em `tipo` — F = Fabricado (aceita ordem de produção). */
export type TinyTipoProduto = 'K' | 'S' | 'V' | 'F' | 'M';

export interface ProdutoParaImportar {
  sku: string;
  descricao: string;
  tipo?: TinyTipoProduto;
  unidade?: string;
  /** Ficha técnica — vai em `descricaoComplementar`, que é campo livre. */
  fichaTecnica?: string;
  preco?: number;
  /** Custo REAL. Ausente = não enviamos o campo (nunca estimar custo). */
  precoCusto?: number;
  /** Centímetros — é a unidade que o Tiny e o Melhor Envio usam. */
  comprimentoCm?: number;
  larguraCm?: number;
  alturaCm?: number;
  /** Quilos. */
  pesoKg?: number;
  /** Feito sob encomenda: não trava venda por saldo zero. */
  sobEncomenda?: boolean;
}

export interface ResultadoImportacao {
  sku: string;
  acao: 'criado' | 'atualizado' | 'erro';
  idTiny?: number;
  erro?: string;
}

interface ProdutoTiny {
  id: number;
  sku?: string;
}

/**
 * Escreve produtos no Tiny — o caminho inverso do sync.
 *
 * Existe porque a conta do ERP nasce vazia e o catálogo tem que chegar lá de
 * algum lugar. Depois disso o Tiny vira a fonte da verdade e o fluxo se inverte:
 * o app passa a LER de lá (itens 4 e 5 do plano).
 *
 * **Idempotente por SKU**: procura antes de criar e atualiza se já existe. Sem
 * isso, rodar duas vezes duplicaria o catálogo inteiro — e catálogo duplicado
 * em ERP contamina pedido, estoque e nota.
 *
 * ⚠️ **O que este service NÃO faz de propósito:** inventar dado fiscal (NCM,
 * origem, CEST) e inventar custo. Ambos têm consequência — NCM errado é
 * problema fiscal, custo chutado vira margem mentirosa no DRE. Campo sem dado
 * real não é enviado, e fica visível que falta.
 */
@Injectable()
export class TinyProdutosService {
  private readonly logger = new Logger(TinyProdutosService.name);
  /**
   * Pausa entre escritas. O teto de ESCRITA do Tiny é menor que o de leitura e
   * vale por conta — 12 POSTs seguidos tomaram 429 no meio da primeira
   * importação real (26/08), deixando um item de fora sem motivo.
   */
  private static readonly PAUSA_ENTRE_ESCRITAS_MS = 400;

  constructor(private readonly client: TinyClientService) {}

  async importar(
    empresaId: string,
    produtos: ProdutoParaImportar[],
  ): Promise<{
    total: number;
    criados: number;
    atualizados: number;
    erros: number;
    itens: ResultadoImportacao[];
  }> {
    const itens: ResultadoImportacao[] = [];

    // Sequencial de propósito: o rate limit de ESCRITA do Tiny é menor que o de
    // leitura e vale por conta. Um catálogo de dezenas de itens não justifica
    // arriscar 429 no meio e deixar metade cadastrada.
    for (const [i, p] of produtos.entries()) {
      if (i > 0) await this.respirar();
      try {
        const existente = await this.acharPorSku(empresaId, p.sku);
        const corpo = this.montarCorpo(p);
        if (existente) {
          await this.comRetry429(() =>
            this.client.put(empresaId, `/produtos/${existente.id}`, corpo),
          );
          itens.push({ sku: p.sku, acao: 'atualizado', idTiny: existente.id });
        } else {
          const criado = await this.comRetry429(() =>
            this.client.post<{ id: number }>(empresaId, '/produtos', corpo),
          );
          itens.push({ sku: p.sku, acao: 'criado', idTiny: criado?.id });
        }
      } catch (err) {
        // Um SKU que falha não interrompe os outros: metade do catálogo dentro
        // é melhor que nenhum, e o relatório diz exatamente qual faltou.
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[tiny] importar ${p.sku} falhou: ${msg}`);
        itens.push({ sku: p.sku, acao: 'erro', erro: msg.slice(0, 200) });
      }
    }

    const resumo = {
      total: itens.length,
      criados: itens.filter((i) => i.acao === 'criado').length,
      atualizados: itens.filter((i) => i.acao === 'atualizado').length,
      erros: itens.filter((i) => i.acao === 'erro').length,
      itens,
    };
    this.logger.log(
      `[tiny] importação de produtos: ${resumo.criados} criados, ${resumo.atualizados} atualizados, ${resumo.erros} erros`,
    );
    return resumo;
  }

  private respirar(): Promise<void> {
    return new Promise((r) => setTimeout(r, TinyProdutosService.PAUSA_ENTRE_ESCRITAS_MS));
  }

  /**
   * 429 é "agora não", não "não". Uma única nova tentativa depois de 3s resolve
   * a rajada sem transformar limite de taxa em item faltando no catálogo.
   */
  private async comRetry429<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/HTTP 429/.test(msg)) throw err;
      this.logger.warn('[tiny] 429 na escrita — esperando 3s e tentando de novo');
      await new Promise((r) => setTimeout(r, 3000));
      return fn();
    }
  }

  /** Busca pelo código (o SKU) — é a chave que amarra site ↔ ERP ↔ app. */
  private async acharPorSku(empresaId: string, sku: string): Promise<ProdutoTiny | null> {
    const r = await this.client.get<{ itens?: ProdutoTiny[] }>(empresaId, '/produtos', {
      codigo: sku,
      limit: 50,
    });
    // O filtro `codigo` é busca, não igualdade — MB-01 casaria MB-010 se
    // existisse. A conferência exata é aqui.
    return (r.itens ?? []).find((i) => (i.sku ?? '').trim() === sku) ?? null;
  }

  private montarCorpo(p: ProdutoParaImportar): Record<string, unknown> {
    const corpo: Record<string, unknown> = {
      sku: p.sku,
      descricao: p.descricao,
      // SIMPLES por padrão, e não Fabricado, apesar de o alvo ser produzir com
      // OP: o Tiny RECUSA tipo F sem "informações de produção" — a estrutura
      // (lista de componentes) tem que vir junto no cadastro (400 na primeira
      // importação real, 26/08). Inventar uma lista de matéria-prima seria
      // inventar como a fábrica monta o produto. Então nasce S, que vende,
      // estoca e fatura, e vira F com um PUT quando a estrutura existir — a
      // importação é idempotente por SKU, então converter não duplica nada.
      tipo: p.tipo ?? 'S',
      unidade: p.unidade ?? 'UN',
      situacao: 'A',
    };
    if (p.fichaTecnica) corpo.descricaoComplementar = p.fichaTecnica;

    const precos: Record<string, number> = {};
    if (typeof p.preco === 'number') precos.preco = p.preco;
    if (typeof p.precoCusto === 'number') precos.precoCusto = p.precoCusto;
    if (Object.keys(precos).length > 0) corpo.precos = precos;

    const dim: Record<string, number> = {};
    if (p.comprimentoCm) dim.comprimento = p.comprimentoCm;
    if (p.larguraCm) dim.largura = p.larguraCm;
    if (p.alturaCm) dim.altura = p.alturaCm;
    // Peso bruto = líquido enquanto não há dado de embalagem. É o peso que o
    // Melhor Envio usa pra cotar, então deixar vazio quebraria a cotação.
    if (p.pesoKg) {
      dim.pesoLiquido = p.pesoKg;
      dim.pesoBruto = p.pesoKg;
    }
    if (Object.keys(dim).length > 0) corpo.dimensoes = dim;

    corpo.estoque = {
      controlar: true,
      // Fabricado sob encomenda: sem isto, saldo zero (que é o normal aqui)
      // barra a venda em vez de gerar produção.
      sobEncomenda: p.sobEncomenda ?? true,
    };
    return corpo;
  }
}
