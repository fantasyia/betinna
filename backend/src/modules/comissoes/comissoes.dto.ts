import { ComissaoTipo } from '@prisma/client';
import { z } from 'zod';

const MES_MIN = 1;
const MES_MAX = 12;
const ANO_MIN = 2020;
const ANO_MAX = 2100;

export const fecharMesSchema = z.object({
  mes: z.coerce.number().int().min(MES_MIN).max(MES_MAX),
  ano: z.coerce.number().int().min(ANO_MIN).max(ANO_MAX),
  /** Se true, sobrescreve comissões já fechadas (use com cuidado) */
  reprocessar: z.boolean().optional().default(false),
});
export type FecharMesDto = z.infer<typeof fecharMesSchema>;

export const listComissoesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  ano: z.coerce.number().int().min(ANO_MIN).max(ANO_MAX).optional(),
  mes: z.coerce.number().int().min(MES_MIN).max(MES_MAX).optional(),
  representanteId: z.string().cuid().optional(),
  pago: z.coerce.boolean().optional(),
  tipo: z.nativeEnum(ComissaoTipo).optional(),
});
export type ListComissoesDto = z.infer<typeof listComissoesSchema>;

export const marcarPagoSchema = z.object({
  reciboUrl: z.string().url().optional(),
});
export type MarcarPagoDto = z.infer<typeof marcarPagoSchema>;
