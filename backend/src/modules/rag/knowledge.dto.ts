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

/** Upload de documento (PDF/DOCX/TXT/…) pra base de conhecimento. dataBase64 ≤ ~20MB. */
export const createKnowledgeDocumentoSchema = z.object({
  titulo: z.string().trim().min(2).max(160),
  fileName: z.string().trim().min(1).max(255),
  mimetype: z.string().trim().min(3).max(120),
  /** true = o bot pode ENVIAR o arquivo inteiro ao lead (catálogo, tabela de preços). */
  podeEnviar: z.boolean().optional(),
  // base64 cru (~27MB de string = ~20MB de binário).
  dataBase64: z.string().min(1).max(28_000_000),
});
export type CreateKnowledgeDocumentoDto = z.infer<typeof createKnowledgeDocumentoSchema>;

export const updateKnowledgeDocumentoSchema = z
  .object({
    titulo: z.string().trim().min(2).max(160).optional(),
    podeEnviar: z.boolean().optional(),
  })
  .refine((d) => d.titulo !== undefined || d.podeEnviar !== undefined, {
    message: 'Informe titulo ou podeEnviar',
  });
export type UpdateKnowledgeDocumentoDto = z.infer<typeof updateKnowledgeDocumentoSchema>;

export const listKnowledgeSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  /** Inclui chunks derivados da config (fonte=CONFIG). Default só os MANUAL. */
  incluirConfig: z.coerce.boolean().optional(),
});
export type ListKnowledgeDto = z.infer<typeof listKnowledgeSchema>;
