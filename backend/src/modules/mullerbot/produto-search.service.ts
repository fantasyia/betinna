import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { EmbeddingService } from '@integrations/embeddings/embedding.service';

/**
 * Resultado de uma busca de produtos relevantes.
 * Score é em escala arbitrária — usar apenas pra ordenação relativa.
 */
export interface ProdutoRelevante {
  id: string;
  nome: string;
  descricao: string | null;
  marca: string | null;
  linha: string | null;
  categoria: string | null;
  unidade: string | null;
  precoTabela: number;
  sku: string | null;
  codigoOmie: string | null;
  score: number;
  /** Trechos que casaram com a busca. Útil pra debug e citação na resposta. */
  matches: string[];
}

/**
 * Busca de produtos pro MullerBot via keyword scoring (TF simples).
 *
 * Algoritmo (MVP):
 *  - Tokeniza pergunta (lower + remove acentos + split palavras alfanuméricas)
 *  - Filtra stopwords curtas
 *  - Para cada produto da empresa, soma matches por campo com pesos:
 *      nome=3, marca=2, linha/categoria=1.5, descricao=1
 *  - Retorna top N por score
 *
 * Busca SEMÂNTICA (pgvector) com FALLBACK por keyword: embeda a pergunta e ordena
 * por similaridade cosseno sobre os produtos já indexados; se não houver chave/
 * embedding (mock, dev, backfill em andamento) cai no keyword scoring TF abaixo.
 * `buscar` mantém a assinatura — callers não mudam.
 */
@Injectable()
export class ProdutoSearchService {
  private readonly logger = new Logger(ProdutoSearchService.name);

  private static readonly STOPWORDS = new Set([
    'a',
    'o',
    'e',
    'de',
    'da',
    'do',
    'das',
    'dos',
    'um',
    'uma',
    'que',
    'pra',
    'para',
    'em',
    'com',
    'sem',
    'sobre',
    'tem',
    'tens',
    'há',
    'ha',
    'eu',
    'voce',
    'você',
    'qual',
    'quais',
    'como',
    'quanto',
    'quem',
    'onde',
    'quando',
    'porque',
    'meu',
    'minha',
    'no',
    'na',
    'nos',
    'nas',
    'me',
    'te',
    'se',
    'mas',
    'ou',
    'esse',
    'essa',
    'isso',
    'aquele',
    'aquela',
    'aquilo',
    'oi',
    'olá',
    'tudo',
    'bem',
    'obrigado',
    'obrigada',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async buscar(empresaId: string, consulta: string, limit = 5): Promise<ProdutoRelevante[]> {
    const semantico = await this.buscarSemantico(empresaId, consulta, limit);
    if (semantico !== null) return semantico;
    return this.buscarKeyword(empresaId, consulta, limit);
  }

  /**
   * Busca por similaridade cosseno (pgvector). Retorna null quando não dá pra
   * usar semântica (sem embedding da pergunta, ou nenhum produto indexado) →
   * o chamador faz fallback pro keyword.
   */
  private async buscarSemantico(
    empresaId: string,
    consulta: string,
    limit: number,
  ): Promise<ProdutoRelevante[] | null> {
    const texto = consulta.trim();
    if (texto.length === 0) return [];
    const vec = await this.embedding.gerar(empresaId, texto);
    if (!vec) return null; // sem chave/mock → keyword

    const literal = `[${vec.join(',')}]`;
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          nome: string;
          descricao: string | null;
          marca: string | null;
          linha: string | null;
          categoria: string | null;
          unidade: string | null;
          precoTabela: unknown;
          sku: string | null;
          codigoOmie: string | null;
          score: number;
        }>
      >`
        SELECT "id", "nome", "descricao", "marca", "linha", "categoria", "unidade",
               "precoTabela", "sku", "codigoOmie",
               1 - ("embedding" <=> ${literal}::vector) AS score
        FROM "Produto"
        WHERE "empresaId" = ${empresaId} AND "ativo" = true AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> ${literal}::vector
        LIMIT ${limit}`;
      // Nenhum produto indexado ainda (backfill pendente) → deixa o keyword tentar.
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        id: r.id,
        nome: r.nome,
        descricao: r.descricao,
        marca: r.marca,
        linha: r.linha,
        categoria: r.categoria,
        unidade: r.unidade,
        precoTabela: Number(r.precoTabela),
        sku: r.sku,
        codigoOmie: r.codigoOmie,
        score: Number(r.score),
        matches: ['semantico'],
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Busca semântica falhou, caindo no keyword: ${msg}`);
      return null;
    }
  }

  /** Busca por keyword (TF). Fallback quando a semântica não está disponível. */
  private async buscarKeyword(
    empresaId: string,
    consulta: string,
    limit = 5,
  ): Promise<ProdutoRelevante[]> {
    const tokens = this.tokenize(consulta);
    if (tokens.length === 0) return [];

    // Carrega os produtos ativos da empresa. Volume típico <500 itens, scoring em
    // memória é trivial — só usado como fallback da semântica.
    const produtos = await this.prisma.produto.findMany({
      where: { empresaId, ativo: true },
      select: {
        id: true,
        nome: true,
        descricao: true,
        marca: true,
        linha: true,
        categoria: true,
        unidade: true,
        precoTabela: true,
        sku: true,
        codigoOmie: true,
      },
    });

    const scored: ProdutoRelevante[] = [];
    for (const p of produtos) {
      const { score, matches } = this.scoreProduto(p, tokens);
      if (score > 0) scored.push({ ...p, precoTabela: Number(p.precoTabela), score, matches });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** Tokenização compartilhada (exposta pra testes). */
  tokenize(s: string): string[] {
    return s
      .toLowerCase()
      .normalize('NFD')

      .replace(/[̀-ͯ]/g, '') // remove acentos
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !ProdutoSearchService.STOPWORDS.has(t));
  }

  private scoreProduto(
    p: {
      nome: string;
      descricao: string | null;
      marca: string | null;
      linha: string | null;
      categoria: string | null;
    },
    tokens: string[],
  ): { score: number; matches: string[] } {
    const fields: Array<{ texto: string | null; peso: number; label: string }> = [
      { texto: p.nome, peso: 3, label: 'nome' },
      { texto: p.marca, peso: 2, label: 'marca' },
      { texto: p.linha, peso: 1.5, label: 'linha' },
      { texto: p.categoria, peso: 1.5, label: 'categoria' },
      { texto: p.descricao, peso: 1, label: 'descricao' },
    ];
    let score = 0;
    const matches: string[] = [];
    for (const f of fields) {
      if (!f.texto) continue;
      const haystack = this.normalizar(f.texto);
      for (const tk of tokens) {
        if (haystack.includes(tk)) {
          score += f.peso;
          matches.push(`${f.label}:${tk}`);
        }
      }
    }
    return { score, matches };
  }

  private normalizar(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')

      .replace(/[̀-ͯ]/g, '');
  }
}
