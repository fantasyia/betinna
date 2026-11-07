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
const PREFIXO_FICHA = 'Produto · ';

// Stopwords pt-BR (≥3 chars — as <3 já caem no filtro de tamanho). Removidas da tokenização do
// keyword fallback pra não casar quase todo chunk por palavra vazia. Lista enxuta das mais comuns.
const STOPWORDS_PT = new Set([
  'que',
  'para',
  'com',
  'uma',
  'por',
  'dos',
  'das',
  'nao',
  'não',
  'mas',
  'como',
  'mais',
  'foi',
  'ele',
  'ela',
  'seu',
  'sua',
  'ser',
  'tem',
  'são',
  'sao',
  'ter',
  'esse',
  'essa',
  'este',
  'esta',
  'isso',
  'sobre',
  'entre',
  'quando',
  'onde',
  'qual',
  'quais',
  'pelo',
  'pela',
  'nos',
  'nas',
  'aos',
  'meu',
  'minha',
  'você',
  'voce',
  'vocês',
  'voces',
  'estou',
  'está',
  'esta',
  'aqui',
  'ali',
  'sim',
  'pra',
  'pro',
  'até',
  'ate',
  'já',
  'jah',
  'porque',
  'porém',
  'porem',
  'também',
  'tambem',
]);

/** Palavras de conteúdo, sem acento e minúsculas (≥3 letras, fora a stoplist). */
function palavrasDe(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS_PT.has(t));
}

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
    const [fichas, semantico] = await Promise.all([
      this.fichasCitadas(empresaId, consulta).catch(() => [] as ConhecimentoRelevante[]),
      this.buscarSemantico(empresaId, consulta, limit),
    ]);
    const outros = semantico ?? (await this.buscarKeyword(empresaId, consulta, limit));
    if (fichas.length === 0) return outros;
    const ja = new Set(fichas.map((f) => f.id));
    return [...fichas, ...outros.filter((c) => !ja.has(c.id))].slice(
      0,
      Math.max(limit, fichas.length),
    );
  }

  /**
   * Ficha do produto que a pergunta CITA pelo nome entra sempre (Léo, 07/11).
   * "qual o preço da bermuda de moletom no plus size?" perdia a ficha
   * "Produto · Bermuda de Moletom" pra trechos parecidos (medidas, tabelas
   * gerais): a ficha é longa, cheia de medida, e o vetor dela fica diluído. O
   * robô respondia "vou chamar o Léo" com o preço na base. Casa quando todas as
   * palavras do nome do produto aparecem na pergunta; no máximo 2 fichas.
   */
  private async fichasCitadas(
    empresaId: string,
    consulta: string,
  ): Promise<ConhecimentoRelevante[]> {
    const pergunta = new Set(palavrasDe(consulta));
    if (pergunta.size === 0) return [];
    const fichas = await this.prisma.knowledgeChunk.findMany({
      where: { empresaId, ativo: true, fonte: 'CONFIG', titulo: { startsWith: PREFIXO_FICHA } },
      select: { id: true, titulo: true, conteudo: true, categoria: true, fonte: true },
    });
    return fichas
      .map((f) => ({ f, nome: palavrasDe(f.titulo.slice(PREFIXO_FICHA.length)) }))
      .filter(({ nome }) => nome.length > 0 && nome.every((p) => pergunta.has(p)))
      .sort((a, b) => b.nome.length - a.nome.length)
      .slice(0, 2)
      .map(({ f }) => ({ ...f, score: 1 }));
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
    // Stoplist pt-BR: sem ela, palavras vazias ("que", "para", "com"…) casam quase todo chunk e
    // deslocam os relevantes (o keyword fallback não tem score) → lixo no prompt do bot.
    const tokens = Array.from(
      new Set(
        termo
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
          .filter((t) => t.length >= 3 && !STOPWORDS_PT.has(t)),
      ),
    ).slice(0, 10);
    // Só cai no termo cru se a consulta era SÓ stopwords (raro) — evita OR com a frase inteira.
    const palavras = tokens.length > 0 ? tokens : [];
    if (palavras.length === 0) return [];
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
