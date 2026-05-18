import { z } from 'zod';

const slugRegex = /^[a-z0-9-]+$/;

export const upsertPesquisaSchema = z.object({
  slug: z.string().trim().min(2).max(60).regex(slugRegex),
  titulo: z.string().trim().min(2).max(200),
  descricao: z.string().trim().max(2000).nullable().optional(),
  mensagemAgradecimento: z.string().trim().max(1000).nullable().optional(),
  pergunta: z.string().trim().min(5).max(500).default('O quanto você nos recomendaria de 0 a 10?'),
  perguntaFollowUp: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .default('Conta pra gente o que motivou essa nota'),
  ativo: z.boolean().default(true),
  expiraEm: z.string().datetime().nullable().optional(),
});
export type UpsertPesquisaDto = z.infer<typeof upsertPesquisaSchema>;

export const submitNpsSchema = z.object({
  nota: z.number().int().min(0).max(10),
  comentario: z.string().trim().max(2000).nullable().optional(),
  contato: z.string().trim().max(200).nullable().optional(),
  clienteId: z.string().cuid().nullable().optional(),
});
export type SubmitNpsDto = z.infer<typeof submitNpsSchema>;

export function categorizarNota(n: number): 'DETRATOR' | 'PASSIVO' | 'PROMOTOR' {
  if (n <= 6) return 'DETRATOR';
  if (n <= 8) return 'PASSIVO';
  return 'PROMOTOR';
}
