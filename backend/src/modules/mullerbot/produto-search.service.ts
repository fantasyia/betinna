import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';

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
 * Interface deliberadamente simples — pode ser substituída por embeddings/pgvector
 * sem mudar callers (`buscar` mantém assinatura).
 */
@Injectable()
export class ProdutoSearchService {
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

  constructor(private readonly prisma: PrismaService) {}

  async buscar(empresaId: string, consulta: string, limit = 5): Promise<ProdutoRelevante[]> {
    const tokens = this.tokenize(consulta);
    if (tokens.length === 0) return [];

    // Pra MVP carregamos todos os produtos ativos da empresa. Volume típico
    // <500 itens, scoring em memória é trivial. Acima disso, mover pra DB.
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
