import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '@database/prisma.service';
import { EmbeddingService, EMBEDDING_DIMS } from '@integrations/embeddings/embedding.service';
import { INDEXACAO_QUEUE, type IndexacaoJobData } from './rag.types';

/** Opções padrão do job: retry exponencial, limpeza automática. */
const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: 500,
  removeOnFail: 200,
};

/** Vetor pro literal pgvector: '[0.1,0.2,...]'. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

function hashTexto(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

/**
 * Indexação semântica (RAG). Enfileira e executa a geração de embedding de
 * produtos e chunks de conhecimento. A escrita do vetor é via $executeRaw porque
 * o Prisma não tipa a coluna `vector` (Unsupported).
 */
@Injectable()
export class IndexacaoService {
  private readonly logger = new Logger(IndexacaoService.name);

  constructor(
    @InjectQueue(INDEXACAO_QUEUE) private readonly queue: Queue<IndexacaoJobData>,
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  /** Best-effort: enfileira sem derrubar a operação principal se a fila falhar. */
  async enfileirarProduto(id: string, empresaId: string): Promise<void> {
    await this.enfileirar({ tipo: 'produto', id, empresaId });
  }

  async enfileirarChunk(id: string, empresaId: string): Promise<void> {
    await this.enfileirar({ tipo: 'chunk', id, empresaId });
  }

  private async enfileirar(data: IndexacaoJobData): Promise<void> {
    try {
      // jobId determinístico → re-enfileirar o mesmo item não duplica job pendente.
      await this.queue.add('indexar', data, { ...JOB_OPTS, jobId: `${data.tipo}:${data.id}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao enfileirar indexação ${data.tipo}:${data.id}: ${msg}`);
    }
  }

  /** Executa o job (chamado pelo processor). */
  async processar(data: IndexacaoJobData): Promise<void> {
    if (data.tipo === 'produto') return this.indexarProduto(data.id, data.empresaId);
    return this.indexarChunk(data.id, data.empresaId);
  }

  /**
   * Guarda anti-loop: se o embedding não tem a dimensão da coluna vector(1536) — ex.: alguém
   * trocou EMBEDDING_MODEL por um de outra dimensão — o cast ::vector falha SEMPRE e o
   * reconciliador re-gera (e re-paga) o embedding a cada 5min. Melhor pular e alertar.
   */
  private dimOk(vec: number[], ref: string): boolean {
    if (vec.length === EMBEDDING_DIMS) return true;
    this.logger.error(
      `Embedding ${ref} com ${vec.length} dims (esperado ${EMBEDDING_DIMS}) — EMBEDDING_MODEL não ` +
        `casa com a coluna vector(${EMBEDDING_DIMS}). Pulando pra não loopar re-pagando embedding.`,
    );
    return false;
  }

  private async indexarProduto(id: string, empresaId: string): Promise<void> {
    const p = await this.prisma.produto.findFirst({
      where: { id, empresaId },
      select: {
        nome: true,
        descricao: true,
        marca: true,
        linha: true,
        categoria: true,
        unidade: true,
        embeddingAtualizadoEm: true,
        embeddingTextoHash: true,
      },
    });
    if (!p) return; // produto sumiu — nada a indexar
    const texto = [p.nome, p.marca, p.linha, p.categoria, p.unidade, p.descricao]
      .filter(Boolean)
      .join(' — ');
    const hash = hashTexto(texto);
    // Texto idêntico ao já embeddado → só carimba (barato), não chama OpenAI. Evita
    // reembeddar a cada sync de estoque/preço (que mexe em atualizadoEm, não no texto).
    if (p.embeddingAtualizadoEm && p.embeddingTextoHash === hash) {
      await this.prisma.produto.update({
        where: { id },
        data: { embeddingAtualizadoEm: new Date() },
      });
      return;
    }
    const vec = await this.embedding.gerar(empresaId, texto);
    // Sem chave/mock/falha → não carimba (reconciliador tenta de novo quando houver chave).
    if (!vec) return;
    if (!this.dimOk(vec, `Produto ${id}`)) return;
    await this.prisma.$executeRaw`
      UPDATE "Produto"
      SET "embedding" = ${toVectorLiteral(vec)}::vector,
          "embeddingAtualizadoEm" = NOW(),
          "embeddingTextoHash" = ${hash}
      WHERE "id" = ${id}`;
  }

  private async indexarChunk(id: string, empresaId: string): Promise<void> {
    const c = await this.prisma.knowledgeChunk.findFirst({
      where: { id, empresaId },
      select: {
        titulo: true,
        conteudo: true,
        categoria: true,
        embeddingAtualizadoEm: true,
        embeddingTextoHash: true,
      },
    });
    if (!c) return;
    const texto = [c.categoria, c.titulo, c.conteudo].filter(Boolean).join(' — ');
    const hash = hashTexto(texto);
    if (c.embeddingAtualizadoEm && c.embeddingTextoHash === hash) {
      await this.prisma.knowledgeChunk.update({
        where: { id },
        data: { embeddingAtualizadoEm: new Date() },
      });
      return;
    }
    const vec = await this.embedding.gerar(empresaId, texto);
    if (!vec) return;
    if (!this.dimOk(vec, `KnowledgeChunk ${id}`)) return;
    await this.prisma.$executeRaw`
      UPDATE "KnowledgeChunk"
      SET "embedding" = ${toVectorLiteral(vec)}::vector,
          "embeddingAtualizadoEm" = NOW(),
          "embeddingTextoHash" = ${hash}
      WHERE "id" = ${id}`;
  }
}
