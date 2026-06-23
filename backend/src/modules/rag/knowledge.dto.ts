import { z } from 'zod';

export const createKnowledgeSchema = z.object({
  titulo: z.string().trim().min(2).max(160),
  conteudo: z.string().trim().min(2).max(5000),
  categoria: z.string().trim().max(60).optional(),
  ativo: z.boolean().optional(),
});
export type CreateKnowledgeDto = z.infer<typeof createKnowledgeSchema>;

export const updateKnowledgeSchema = createKnowledgeSchema.partial();
export type UpdateKnowledgeDto = z.infer<typeof updateKnowledgeSchema>;

export const listKnowledgeSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  /** Inclui chunks derivados da config (fonte=CONFIG). Default só os MANUAL. */
  incluirConfig: z.coerce.boolean().optional(),
});
export type ListKnowledgeDto = z.infer<typeof listKnowledgeSchema>;
