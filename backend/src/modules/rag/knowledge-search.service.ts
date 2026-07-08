import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { EmbeddingService } from '@integrations/embeddings/embedding.service';

export interface ConhecimentoRelevante {
  id: string;
  titulo: string;
  conteudo: string;
  categoria: string | null;
  fonte?: 'MANUAL' | 'CONFIG' | 'MATERIAL';
  score: number;
}

/**
 * Bônus de score dado ao texto digitado (MANUAL/CONFIG) sobre o conteúdo extraído de
 * documentos (MATERIAL). Implementa a regra do produto: o bot prioriza a informação
 * que a empresa escreveu à mão (FAQ/condições) e só recorre ao texto de um documento
 * (catálogo/tabela em PDF) quando o texto digitado não responde tão bem. Um documento
 * MUITO mais relevante ainda vence — o bônus só desempata casos próximos.
 */
const BONUS_TEXTO = 0.05;
// Similaridade de cosseno mínima pra um chunk ser considerado RELEVANTE. #33: sem piso, os top-K
// entravam no prompt por mais irrelevantes que fossem (ex.: política de devolução numa pergunta de
// produto) — poluía a resposta e gastava tokens. ~0.3 é um floor conservador (irrelevante ~0.0-0.2).
const SCORE_MINIMO_SEMANTICO = 0.3;

/**
 * Busca semântica sobre a base de conhecimento (KnowledgeChunk) com fallback por
 * keyword (ILIKE) — mesma lógica do ProdutoSearchService. Alimenta o bot com FAQ /
 * condições / políticas além do catálogo. Texto digitado tem prioridade sobre o
 * conteúdo de documentos (ver BONUS_TEXTO).
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
      // score = similaridade crua (exibida); a ORDENAÇÃO usa o score + bônus do texto
      // digitado, então o doc só sobe quando é claramente mais relevante que o FAQ.
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          titulo: string;
          conteudo: string;
          categoria: string | null;
          fonte: 'MANUAL' | 'CONFIG' | 'MATERIAL';
          score: number;
        }>
      >`
        SELECT "id", "titulo", "conteudo", "categoria", "fonte",
               1 - ("embedding" <=> ${literal}::vector) AS score
        FROM "KnowledgeChunk"
        WHERE "empresaId" = ${empresaId} AND "ativo" = true AND "embedding" IS NOT NULL
        ORDER BY
          (1 - ("embedding" <=> ${literal}::vector))
            + (CASE WHEN "fonte" = 'MATERIAL' THEN 0 ELSE ${BONUS_TEXTO} END) DESC
        LIMIT ${limit}`;
      if (rows.length === 0) return null;
      // #33: descarta chunks abaixo do piso de similaridade. Se nenhum passa, retorna null (cai no
      // keyword, mesmo comportamento de "sem resultado semântico") em vez de injetar lixo no prompt.
      const relevantes = rows
        .map((r) => ({ ...r, score: Number(r.score) }))
        .filter((r) => r.score >= SCORE_MINIMO_SEMANTICO);
      return relevantes.length > 0 ? relevantes : null;
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
    // Tokeniza a consulta (OR por palavra ≥3 chars, acento preservado): `contains` da frase
    // INTEIRA quase nunca casa, deixando o conhecimento inacessível durante o backfill.
    const tokens = Array.from(
      new Set(
        termo
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
          .filter((t) => t.length >= 3),
      ),
    ).slice(0, 10);
    const palavras = tokens.length > 0 ? tokens : [termo];
    // Pega mais que o limite e re-ordena texto-antes-de-doc em memória (o `contains`
    // não dá score; sem embedding, a prioridade do texto digitado é por fonte).
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        empresaId,
        ativo: true,
        OR: palavras.flatMap((t) => [
          { titulo: { contains: t, mode: 'insensitive' as const } },
          { conteudo: { contains: t, mode: 'insensitive' as const } },
        ]),
      },
      select: { id: true, titulo: true, conteudo: true, categoria: true, fonte: true },
      take: limit * 3,
    });
    const prioridade = (f: string) => (f === 'MATERIAL' ? 1 : 0);
    return chunks
      .sort((a, b) => prioridade(a.fonte) - prioridade(b.fonte))
      .slice(0, limit)
      .map((c) => ({ ...c, score: 0 }));
  }
}
