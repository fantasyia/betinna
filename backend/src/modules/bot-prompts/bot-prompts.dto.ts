import { z } from 'zod';

/**
 * DTOs da biblioteca de prompts do bot (orquestração Fase A).
 */
export const createBotPromptSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  descricao: z.string().trim().max(1000).optional(),
  texto: z.string().trim().min(1).max(20000),
  /** Override do modelo OpenAI (vazio = usa o da empresa/persona). */
  modelo: z.string().trim().max(60).optional(),
  temperatura: z.number().min(0).max(2).optional(),
  isPadrao: z.boolean().optional(),
  ativo: z.boolean().optional(),
  /** Teto de tokens por prompt (spec §7). Null/omitido = sem teto próprio. */
  tetoTokensDia: z.number().int().min(0).nullable().optional(),
  tetoTokensMes: z.number().int().min(0).nullable().optional(),
});
export type CreateBotPromptDto = z.infer<typeof createBotPromptSchema>;

export const updateBotPromptSchema = createBotPromptSchema.partial();
export type UpdateBotPromptDto = z.infer<typeof updateBotPromptSchema>;

export const listBotPromptsSchema = z.object({
  search: z.string().optional(),
});
export type ListBotPromptsDto = z.infer<typeof listBotPromptsSchema>;
