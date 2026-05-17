export interface LlmCredenciais {
  apiKey: string;
  /** Override de modelo. Default: env MULLERBOT_MODEL (gpt-4o-mini). */
  model?: string;
}

export interface MullerBotResposta {
  resposta: string;
  produtosUsados: Array<{
    id: string;
    nome: string;
    sku: string | null;
    codigoOmie: string | null;
    precoTabela: number;
    score: number;
  }>;
  /** Quantos produtos foram cortados pelo limite de tokens (do top-K). */
  produtosTruncados: number;
  modelo: string;
  tokensInEstimados: number;
  tokensIn?: number;
  tokensOut?: number;
  /** True quando resposta veio do cache (sem chamar OpenAI). */
  cacheHit?: boolean;
}
