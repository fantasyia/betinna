import { z } from 'zod';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const createTagSchema = z.object({
  nome: z.string().trim().min(1).max(100),
  cor: z.string().regex(HEX_COLOR, 'Cor deve estar no formato #RRGGBB').default('#7c3aed'),
});
export type CreateTagDto = z.infer<typeof createTagSchema>;

export const updateTagSchema = createTagSchema.partial();
export type UpdateTagDto = z.infer<typeof updateTagSchema>;

export const listTagsSchema = z.object({
  search: z.string().optional(),
});
export type ListTagsDto = z.infer<typeof listTagsSchema>;
