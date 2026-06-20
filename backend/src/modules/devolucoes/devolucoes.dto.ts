import { DevolucaoStatus } from '@prisma/client';
import { z } from 'zod';

export const createDevolucaoSchema = z.object({
  pedidoId: z.string().cuid(),
  motivo: z.string().trim().min(1).max(40),
  itensDescricao: z.string().trim().max(2000).optional(),
  observacao: z.string().trim().max(2000).optional(),
  fotos: z.array(z.string().url()).max(10).optional(),
});
export type CreateDevolucaoDto = z.infer<typeof createDevolucaoSchema>;

export const mudarStatusDevolucaoSchema = z.object({
  status: z.nativeEnum(DevolucaoStatus),
  motivoRecusa: z.string().trim().max(500).optional(),
});
export type MudarStatusDevolucaoDto = z.infer<typeof mudarStatusDevolucaoSchema>;

export const listDevolucoesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z.nativeEnum(DevolucaoStatus).optional(),
  pedidoId: z.string().optional(),
});
export type ListDevolucoesDto = z.infer<typeof listDevolucoesSchema>;
