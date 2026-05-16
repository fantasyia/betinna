import { PagamentoForma, PropostaStatus } from '@prisma/client';
import { z } from 'zod';

export const propostaItemInputSchema = z.object({
  produtoId: z.string().cuid(),
  quantidade: z.number().int().min(1).max(100_000),
  desconto: z.number().min(0).max(80).default(0),
  precoUnitarioOverride: z.number().positive().optional(),
});
export type PropostaItemInputDto = z.infer<typeof propostaItemInputSchema>;

export const createPropostaSchema = z.object({
  clienteId: z.string().cuid(),
  itens: z.array(propostaItemInputSchema).min(1),
  formaPagamento: z.nativeEnum(PagamentoForma).default('BOLETO'),
  condicaoPagamento: z.enum(['avista', '15dias', '30dias', '30_60', '30_60_90']).default('30dias'),
  prazoEntrega: z.coerce.date().optional(),
  descontoGeral: z.number().min(0).max(50).default(0),
  probabilidade: z.number().int().min(0).max(100).default(50),
  validoAte: z.coerce.date().optional(),
  observacoes: z.string().max(2000).optional(),
});
export type CreatePropostaDto = z.infer<typeof createPropostaSchema>;

export const updatePropostaSchema = createPropostaSchema
  .omit({ clienteId: true, itens: true })
  .partial();
export type UpdatePropostaDto = z.infer<typeof updatePropostaSchema>;

export const changeStatusSchema = z.object({
  status: z.nativeEnum(PropostaStatus),
  motivo: z.string().max(500).optional(),
});
export type ChangeStatusDto = z.infer<typeof changeStatusSchema>;

export const listPropostasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['criadoEm', 'valor', 'numero', 'probabilidade']).default('criadoEm'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  status: z.nativeEnum(PropostaStatus).optional(),
  clienteId: z.string().cuid().optional(),
  representanteId: z.string().cuid().optional(),
});
export type ListPropostasDto = z.infer<typeof listPropostasSchema>;
