import { z } from 'zod';

export const updateProgramaSchema = z.object({
  nome: z.string().trim().min(2).max(100).optional(),
  ativo: z.boolean().optional(),
  pontosPorReal: z.coerce.number().min(0).max(100).optional(),
  ttlMeses: z.coerce.number().int().min(0).max(120).optional(),
  valorMinimoPedido: z.coerce.number().min(0).optional(),
});
export type UpdateProgramaDto = z.infer<typeof updateProgramaSchema>;

const recompensaBase = z.object({
  nome: z.string().trim().min(2).max(120),
  descricao: z.string().trim().max(500).optional().nullable(),
  custoPontos: z.coerce.number().int().min(1),
  tipo: z.enum(['DESCONTO_PERCENTUAL', 'DESCONTO_VALOR', 'BRINDE']),
  valor: z.coerce.number().min(0).max(10000).optional().nullable(),
  estoque: z.coerce.number().int().min(0).optional().nullable(),
  ativo: z.boolean().optional(),
});

export const createRecompensaSchema = recompensaBase.refine(
  (d) => d.tipo === 'BRINDE' || (typeof d.valor === 'number' && d.valor > 0),
  { message: 'DESCONTO_* exige valor > 0', path: ['valor'] },
);
export type CreateRecompensaDto = z.infer<typeof createRecompensaSchema>;

export const updateRecompensaSchema = recompensaBase.partial();
export type UpdateRecompensaDto = z.infer<typeof updateRecompensaSchema>;

export const resgatarSchema = z.object({
  clienteId: z.string().min(1),
  recompensaId: z.string().min(1),
});
export type ResgatarDto = z.infer<typeof resgatarSchema>;

export const ajustarSchema = z.object({
  clienteId: z.string().min(1),
  pontos: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, 'pontos não pode ser 0'),
  motivo: z.string().trim().min(3).max(280),
});
export type AjustarDto = z.infer<typeof ajustarSchema>;

export const listMovimentosSchema = z.object({
  clienteId: z.string().min(1).optional(),
  tipo: z
    .enum(['GANHO_PEDIDO', 'ESTORNO_PEDIDO', 'RESGATE', 'EXPIRACAO', 'AJUSTE_MANUAL'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListMovimentosDto = z.infer<typeof listMovimentosSchema>;
