import { z } from 'zod';

/**
 * Contatos — visão UNIFICADA de Lead + Cliente + Conversa (Inbox).
 *
 * Objetivo: dar a "noção" de o que é lead, o que é cliente real e o que é só
 * uma conversa solta — num lugar só, deduplicado por telefone (últimos 8
 * dígitos, regra D18). Não cria entidade nova: agrega as 3 fontes existentes.
 */
export const listContatosSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(30),
  search: z.string().trim().max(120).optional(),
  /** Filtra pra contatos que SÃO desse tipo (um contato pode ter vários). */
  tipo: z.enum(['LEAD', 'CLIENTE', 'CONVERSA']).optional(),
  representanteId: z.string().cuid().optional(),
  sortBy: z.enum(['recente', 'nome']).default('recente'),
});
export type ListContatosDto = z.infer<typeof listContatosSchema>;
