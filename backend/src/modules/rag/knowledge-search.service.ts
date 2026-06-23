import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { EmbeddingService } from '@integrations/embeddings/embedding.service';

export interface ConhecimentoRelevante {
  id: string;
  titulo: string;
  conteudo: string;
  categoria: string | null;
  score: number;
}

/**
 * Busca semântica sobre a base de conhecimento (KnowledgeChunk) com fallback por
 * keyword (ILIKE) — mesma lógica do ProdutoSearchService. Alimenta o bot com FAQ /
 * condições / políticas além do catálogo.
 */
@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async buscar(empresaId: string, consulta: string, limit = 4): Promise<ConhecimentoRelevante[]> {
    const semantico = await this.buscarSemantico(empresaId, consulta, limit);
    if (semantico !== null) return semantico;
    return this.buscarKeyword(empresaId, consulta, limit);
  }

  private async buscarSemantico(
    empresaId: string,
    consulta: string,
    limit: number,
  ): Promise<ConhecimentoRelevante[] | null> {
    const texto = consulta.trim();
    if (texto.length === 0) return [];
    const vec = await this.embedding.gerar(empresaId, texto);
    if (!vec) return null;

    const literal = `[${vec.join(',')}]`;
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          titulo: string;
          conteudo: string;
          categoria: string | null;
          score: number;
        }>
      >`
        SELECT "id", "titulo", "conteudo", "categoria",
               1 - ("embedding" <=> ${literal}::vector) AS score
        FROM "KnowledgeChunk"
        WHERE "empresaId" = ${empresaId} AND "ativo" = true AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> ${literal}::vector
        LIMIT ${limit}`;
      if (rows.length === 0) return null;
      return rows.map((r) => ({ ...r, score: Number(r.score) }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Busca semântica de conhecimento falhou, caindo no keyword: ${msg}`);
      return null;
    }
  }

  private async buscarKeyword(
    empresaId: string,
    consulta: string,
    limit: number,
  ): Promise<ConhecimentoRelevante[]> {
    const termo = consulta.trim();
    if (termo.length === 0) return [];
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        empresaId,
        ativo: true,
        OR: [
          { titulo: { contains: termo, mode: 'insensitive' } },
          { conteudo: { contains: termo, mode: 'insensitive' } },
        ],
      },
      select: { id: true, titulo: true, conteudo: true, categoria: true },
      take: limit,
    });
    return chunks.map((c) => ({ ...c, score: 0 }));
  }
}
