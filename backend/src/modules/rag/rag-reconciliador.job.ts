import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IndexacaoService } from './indexacao.service';

/** Quantos itens (por tipo) enfileira por ciclo — evita inundar a fila/OpenAI. */
const CAP_POR_CICLO = 500;

/**
 * Reconciliador de embeddings (RAG). A cada 5min varre produtos e chunks cujo
 * embedding está faltando ou desatualizado (`embeddingAtualizadoEm` NULL ou
 * anterior a `atualizadoEm`) e enfileira a reindexação.
 *
 * É a rede de segurança ERP-AGNÓSTICA: pega o que o sync do OMIE (ou qualquer
 * outro ERP, ou cadastro manual) escreveu sem passar pelo enqueue direto, além
 * de fazer o backfill inicial — tudo sem tocar no código de integração.
 */
@Injectable()
export class RagReconciliadorJob {
  private readonly logger = new Logger(RagReconciliadorJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexacao: IndexacaoService,
    private readonly env: EnvService,
  ) {}

  @Cron('*/5 * * * *', { name: 'rag-reconciliador', timeZone: 'UTC' })
  async reconciliar(): Promise<void> {
    if (!this.env.get('RAG_INDEXACAO_ATIVA')) return;

    const produtos = await this.prisma.$queryRaw<Array<{ id: string; empresaId: string }>>`
      SELECT "id", "empresaId" FROM "Produto"
      WHERE "ativo" = true
        AND ("embeddingAtualizadoEm" IS NULL OR "embeddingAtualizadoEm" < "atualizadoEm")
      LIMIT ${CAP_POR_CICLO}`;
    for (const p of produtos) await this.indexacao.enfileirarProduto(p.id, p.empresaId);

    const chunks = await this.prisma.$queryRaw<Array<{ id: string; empresaId: string }>>`
      SELECT "id", "empresaId" FROM "KnowledgeChunk"
      WHERE "ativo" = true
        AND ("embeddingAtualizadoEm" IS NULL OR "embeddingAtualizadoEm" < "atualizadoEm")
      LIMIT ${CAP_POR_CICLO}`;
    for (const c of chunks) await this.indexacao.enfileirarChunk(c.id, c.empresaId);

    if (produtos.length > 0 || chunks.length > 0) {
      this.logger.log(
        `RAG reconciliação: ${produtos.length} produto(s) + ${chunks.length} chunk(s) enfileirados`,
      );
    }
  }
}
