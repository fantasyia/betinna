import { ClienteOmieStatus, ClienteStatus } from '@prisma/client';
import { z } from 'zod';

const clienteStatusEnum = z.nativeEnum(ClienteStatus);
const omieStatusEnum = z.nativeEnum(ClienteOmieStatus);

const CNPJ_PATTERN = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
const TEL_MIN = 8;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

export const createClienteSchema = z.object({
  nome: z.string().trim().min(2).max(200),
  cnpj: z
    .string()
    .regex(CNPJ_PATTERN, 'CNPJ deve seguir o formato 00.000.000/0001-00')
    .optional(),
  codigoOmie: z.string().max(50).optional(),
  email: z.string().email().optional(),
  telefone: z.string().min(TEL_MIN).max(30).optional(),
  segmento: z.string().max(60).optional(),
  cidade: z.string().max(100).optional(),
  uf: z.string().length(2).optional(),
  regiao: z.string().max(60).optional(),
  status: clienteStatusEnum.default('NOVO'),
  omieStatus: omieStatusEnum.default('ATIVO'),
  score: z.number().int().min(SCORE_MIN).max(SCORE_MAX).default(50),
  prazoPagamento: z.number().int().min(0).max(180).default(30),
  limiteCredito: z.number().min(0).optional(),
  representanteId: z.string().cuid().optional(),
  tagIds: z.array(z.string().cuid()).optional().default([]),
});
export type CreateClienteDto = z.infer<typeof createClienteSchema>;

export const updateClienteSchema = createClienteSchema.partial();
export type UpdateClienteDto = z.infer<typeof updateClienteSchema>;

export const listClientesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z
    .enum(['nome', 'criadoEm', 'atualizadoEm', 'score', 'ultimoPedidoEm'])
    .default('criadoEm'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  segmento: z.string().optional(),
  regiao: z.string().optional(),
  status: clienteStatusEnum.optional(),
  omieStatus: omieStatusEnum.optional(),
  representanteId: z.string().cuid().optional(),
  tagId: z.string().cuid().optional(),
  /** ID da lista dinâmica (vip, risco, criticos, novos, horeca, inadimplentes, top10) */
  lista: z
    .enum(['vip', 'risco', 'criticos', 'novos', 'horeca', 'inadimplentes', 'top10'])
    .optional(),
  scoreMin: z.coerce.number().int().min(SCORE_MIN).max(SCORE_MAX).optional(),
  scoreMax: z.coerce.number().int().min(SCORE_MIN).max(SCORE_MAX).optional(),
});
export type ListClientesDto = z.infer<typeof listClientesSchema>;

export const assignRepSchema = z.object({
  representanteId: z.string().cuid().nullable(),
});
export type AssignRepDto = z.infer<typeof assignRepSchema>;

export const bulkAssignRepSchema = z.object({
  clienteIds: z.array(z.string().cuid()).min(1).max(500),
  representanteId: z.string().cuid().nullable(),
});
export type BulkAssignRepDto = z.infer<typeof bulkAssignRepSchema>;

export const setTagsSchema = z.object({
  tagIds: z.array(z.string().cuid()),
});
export type SetTagsDto = z.infer<typeof setTagsSchema>;

export const updateOmieStatusSchema = z.object({
  omieStatus: omieStatusEnum,
});
export type UpdateOmieStatusDto = z.infer<typeof updateOmieStatusSchema>;
