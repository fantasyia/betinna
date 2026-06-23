import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const TIMEOUT_MS = 30_000;
/** Dimensão nativa do text-embedding-3-small — casa com a coluna vector(1536). */
export const EMBEDDING_DIMS = 1536;

/**
 * Geração de embeddings (RAG) via OpenAI. Usa a chave da EMPRESA (mesma hierarquia
 * do MullerBot: IntegracaoConexao servico='openai' cifrada, fallback OPENAI_API_KEY).
 *
 * Retorna `null` quando não há chave OU em MULLERBOT_MOCK — o chamador trata null
 * como "não indexado" e a busca cai no fallback por keyword. Assim dev/CI rodam
 * sem custo e sem credencial, e a busca semântica degrada sozinha sem chave.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    private readonly env: EnvService,
    private readonly integracoes: IntegracoesService,
  ) {}

  /** Resolve a chave OpenAI da empresa (integração cifrada → env). */
  private async resolverChave(empresaId: string): Promise<string | undefined> {
    try {
      const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'openai');
      const k = (conn.credenciais as { apiKey?: string }).apiKey;
      if (k && k.trim()) return k.trim();
    } catch {
      // Empresa sem OpenAI no app — cai pro env do Railway.
    }
    return this.env.get('OPENAI_API_KEY') || undefined;
  }

  /** Embedding de um texto. null = sem chave / mock / falha (chamador faz fallback). */
  async gerar(empresaId: string, texto: string): Promise<number[] | null> {
    const [vec] = await this.gerarLote(empresaId, [texto]);
    return vec ?? null;
  }

  /**
   * Embedding de vários textos numa chamada (a API aceita array). Mantém a ordem:
   * índice i da entrada → índice i da saída. Item vazio vira null sem chamar a API.
   */
  async gerarLote(empresaId: string, textos: string[]): Promise<(number[] | null)[]> {
    if (textos.length === 0) return [];
    if (this.env.get('MULLERBOT_MOCK')) return textos.map(() => null);

    const apiKey = await this.resolverChave(empresaId);
    if (!apiKey) return textos.map(() => null);

    // Inputs vazios não vão pra API (custo/erro); mapeia de volta por posição.
    const indicesValidos: number[] = [];
    const inputs: string[] = [];
    textos.forEach((t, i) => {
      const limpo = (t ?? '').trim();
      if (limpo.length > 0) {
        indicesValidos.push(i);
        inputs.push(limpo);
      }
    });
    if (inputs.length === 0) return textos.map(() => null);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.env.get('EMBEDDING_MODEL'), input: inputs }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const corpo = await resp.text().catch(() => '');
        this.logger.warn(`Embeddings OpenAI falhou (HTTP ${resp.status}): ${corpo.slice(0, 200)}`);
        return textos.map(() => null);
      }
      const json = (await resp.json()) as { data?: Array<{ embedding: number[]; index: number }> };
      const saida: (number[] | null)[] = textos.map(() => null);
      for (const item of json.data ?? []) {
        // item.index é relativo a `inputs`; remapeia pro índice original.
        const original = indicesValidos[item.index];
        if (original !== undefined) saida[original] = item.embedding;
      }
      return saida;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Embeddings OpenAI erro: ${msg}`);
      return textos.map(() => null);
    } finally {
      clearTimeout(timer);
    }
  }
}
