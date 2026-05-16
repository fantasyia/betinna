import { z } from 'zod';

export const perguntarSchema = z.object({
  pergunta: z.string().min(1).max(2000),
  /** Override de modelo OpenAI. */
  modelo: z.string().min(1).max(100).optional(),
  /** Quantos produtos relevantes carregar no contexto (top-K). Default 5. */
  topK: z.coerce.number().int().positive().max(20).default(5),
  /** Override do limite de tokens de saída (default vem do env). */
  maxOutputTokens: z.coerce.number().int().positive().max(4096).optional(),
});
export type PerguntarDto = z.infer<typeof perguntarSchema>;
