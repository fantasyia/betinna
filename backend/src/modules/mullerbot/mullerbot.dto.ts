import { z } from 'zod';

export const perguntarSchema = z.object({
  pergunta: z.string().min(1).max(2000),
  /** Override de modelo OpenAI. */
  modelo: z.string().min(1).max(100).optional(),
  /** Quantos produtos relevantes carregar no contexto (top-K). Default 5. */
  topK: z.coerce.number().int().positive().max(20).default(5),
  /** Override do limite de tokens de saída (default vem do env). */
  maxOutputTokens: z.coerce.number().int().positive().max(4096).optional(),
  /**
   * Identificador de sessão de conversa. Se fornecido, MullerBot mantém
   * histórico das últimas N interações em Redis e injeta no contexto da próxima
   * pergunta, permitindo follow-ups ("E o mais barato?", "E desse outro?").
   *
   * Cliente recomendado: gerar UUID no primeiro request e reusar.
   * Default: stateless (cada pergunta independente).
   */
  sessionId: z.string().trim().min(1).max(64).optional(),
  /**
   * Se true, bypassa o cache de respostas (força nova chamada OpenAI).
   * Útil pra debug. Default false (usa cache se disponível).
   */
  semCache: z.boolean().optional(),
});
export type PerguntarDto = z.infer<typeof perguntarSchema>;

export const limparHistoricoSchema = z.object({
  sessionId: z.string().trim().min(1).max(64),
});
export type LimparHistoricoDto = z.infer<typeof limparHistoricoSchema>;
