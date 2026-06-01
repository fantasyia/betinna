import { z } from 'zod';

export const upsertRespostaSchema = z.object({
  titulo: z.string().trim().min(1).max(80),
  atalho: z.string().trim().min(1).max(40),
  conteudo: z.string().trim().min(1).max(4000),
  categoria: z.string().trim().max(40).nullable().optional(),
  /** true = visível pra empresa toda (só ADMIN/DIRECTOR); false = privado do criador. */
  global: z.boolean().default(false),
});
export type UpsertRespostaDto = z.infer<typeof upsertRespostaSchema>;
