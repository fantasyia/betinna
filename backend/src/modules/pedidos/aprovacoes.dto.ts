import { AprovacaoStatus } from '@prisma/client';
import { z } from 'zod';

export const listAprovacoesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(AprovacaoStatus).optional(),
  representanteId: z.string().cuid().optional(),
});
export type ListAprovacoesDto = z.infer<typeof listAprovacoesSchema>;

export const decidirAprovacaoSchema = z.object({
  comentario: z.string().max(500).optional(),
});
export type DecidirAprovacaoDto = z.infer<typeof decidirAprovacaoSchema>;
