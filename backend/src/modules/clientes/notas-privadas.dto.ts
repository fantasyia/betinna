import { z } from 'zod';

export const createNotaSchema = z.object({
  texto: z.string().trim().min(1).max(2000),
});
export type CreateNotaDto = z.infer<typeof createNotaSchema>;

export const updateNotaSchema = createNotaSchema;
export type UpdateNotaDto = z.infer<typeof updateNotaSchema>;
