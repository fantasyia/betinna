import { ContratoStatus } from '@prisma/client';
import { z } from 'zod';

export const listContratosSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(ContratoStatus).optional(),
  clienteId: z.string().cuid().optional(),
  /** Busca por nome do cliente ou número da proposta. */
  search: z.string().max(120).optional(),
});
export type ListContratosDto = z.infer<typeof listContratosSchema>;
