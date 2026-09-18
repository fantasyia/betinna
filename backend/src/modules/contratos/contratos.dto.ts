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

/**
 * Reenvio do contrato pro cliente assinar de novo (cláusula alterada).
 *
 * O `motivo` é obrigatório e não é burocracia: ele é o ÚNICO registro de por que
 * existiu uma segunda rodada. O envelope anterior é expirado na ClickSign, e sem
 * esta linha o histórico mostraria dois envios sem explicação nenhuma.
 */
export const reenviarContratoSchema = z.object({
  motivo: z.string().trim().min(10, 'Diga em uma frase o que mudou no contrato').max(500),
});
export type ReenviarContratoDto = z.infer<typeof reenviarContratoSchema>;
