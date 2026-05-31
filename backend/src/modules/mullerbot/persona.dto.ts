import { z } from 'zod';

/** Tom de voz — define como a persona se expressa. */
export const TOM_VOZ = [
  'FORMAL',
  'PROFISSIONAL',
  'AMIGAVEL',
  'DESCONTRAIDO',
  'ENTUSIASMADO',
] as const;
export type TomVoz = (typeof TOM_VOZ)[number];

export const exemploSchema = z.object({
  pergunta: z.string().trim().min(2).max(500),
  resposta: z.string().trim().min(2).max(2000),
});
export type ExemploDto = z.infer<typeof exemploSchema>;

export const upsertPersonaSchema = z.object({
  nome: z.string().trim().min(1).max(60).default('MullerBot'),
  tomVoz: z.enum(TOM_VOZ).default('PROFISSIONAL'),
  instrucoes: z.string().trim().max(2000).nullable().optional(),
  exemplos: z.array(exemploSchema).max(10).optional(),
  saudacao: z.string().trim().max(280).nullable().optional(),
  ativo: z.boolean().default(true),
  /**
   * Prompt COMPLETO do Muller. Quando preenchido, é usado tal e qual como system
   * prompt (forma principal de configurar). Até 12k chars (~3k tokens).
   */
  promptCustom: z.string().trim().max(12000).nullable().optional(),
});
export type UpsertPersonaDto = z.infer<typeof upsertPersonaSchema>;
