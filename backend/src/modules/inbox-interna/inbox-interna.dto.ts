import { z } from 'zod';

export const criarThreadSchema = z.object({
  tipo: z.string().trim().min(1).max(40),
  assunto: z.string().trim().min(2).max(200),
  mensagem: z.string().trim().min(1).max(5000),
  pedidoId: z.string().cuid().optional(),
  clienteId: z.string().cuid().optional(),
});
export type CriarThreadDto = z.infer<typeof criarThreadSchema>;

export const responderThreadSchema = z.object({
  texto: z.string().trim().min(1).max(5000),
});
export type ResponderThreadDto = z.infer<typeof responderThreadSchema>;

export const listThreadsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z.enum(['ABERTA', 'RESPONDIDA', 'RESOLVIDA']).optional(),
  tipo: z.string().optional(),
});
export type ListThreadsDto = z.infer<typeof listThreadsSchema>;
