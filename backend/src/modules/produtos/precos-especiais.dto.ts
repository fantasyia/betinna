import { z } from 'zod';

export const upsertPrecoEspecialSchema = z.object({
  produtoId: z.string().cuid(),
  precoEspecial: z.number().positive(),
  descontoBase: z.number().min(0).max(80).default(0),
  validoAte: z.coerce.date().optional(),
});
export type UpsertPrecoEspecialDto = z.infer<typeof upsertPrecoEspecialSchema>;

export const bulkUpsertPrecoEspecialSchema = z.object({
  itens: z.array(upsertPrecoEspecialSchema).min(1).max(500),
});
export type BulkUpsertPrecoEspecialDto = z.infer<typeof bulkUpsertPrecoEspecialSchema>;
