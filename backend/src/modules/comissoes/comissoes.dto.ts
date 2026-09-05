import { ComissaoTipo } from '@prisma/client';
import { z } from 'zod';
import { boolQuery } from '@shared/validators/query.schema';
import { usuarioIdSchema } from '@shared/validators/id.schema';

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
  representanteId: usuarioIdSchema.optional(),
  pago: boolQuery.optional(),
  tipo: z.nativeEnum(ComissaoTipo).optional(),
});
export type ListComissoesDto = z.infer<typeof listComissoesSchema>;

export const marcarPagoSchema = z.object({
  reciboUrl: z.string().url().optional(),
});
export type MarcarPagoDto = z.infer<typeof marcarPagoSchema>;

/**
 * "A mensalidade de MM/AAAA daquele contrato entrou."
 *
 * Competência é o MÊS da mensalidade (o que o cliente pagou), não a data do
 * pagamento — mensalidade de setembro paga em outubro continua sendo setembro.
 * `recebidaEm` é opcional porque o caso comum é registrar no dia; informar
 * serve pra lançar atrasado sem mentir a data.
 */
export const mensalidadeRecebidaSchema = z.object({
  contratoId: z.string().min(1),
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competência no formato YYYY-MM'),
  recebidaEm: z.coerce.date().optional(),
});
export type MensalidadeRecebidaDto = z.infer<typeof mensalidadeRecebidaSchema>;
