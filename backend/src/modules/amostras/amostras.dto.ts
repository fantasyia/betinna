import { AmostraStatus } from '@prisma/client';
import { z } from 'zod';

export const createAmostraSchema = z.object({
  clienteId: z.string().cuid(),
  produtoNome: z.string().trim().min(2).max(200),
  /** Produto do catálogo (opcional). Obrigatório só pra enviar a remessa ao OMIE (P7). */
  produtoId: z.string().cuid().optional(),
  /** Quantidade enviada. Amostra grátis = quantidade reduzida. Default 1. */
  quantidade: z.number().positive().max(100000).default(1),
  valor: z.number().min(0),
  notaFiscal: z.string().max(50).optional(),
  enviadoEm: z.coerce.date().optional(),
  /** Dias a partir do envio em que deve ser feito follow-up. Default 5. */
  diasFollowUp: z.number().int().min(1).max(60).default(5),
  representanteNome: z.string().max(150).optional(),
  /** Modo da amostra. Default = 1º modo ativo do tenant (normalmente subsidiada). */
  modo: z.enum(['subsidiada', 'compra_propria', 'compra_cliente']).optional(),
});
export type CreateAmostraDto = z.infer<typeof createAmostraSchema>;

export const rejeitarAmostraSchema = z.object({
  motivo: z.string().trim().min(3).max(500),
});
export type RejeitarAmostraDto = z.infer<typeof rejeitarAmostraSchema>;

export const updateAmostraSchema = z.object({
  produtoNome: z.string().min(2).max(200).optional(),
  produtoId: z.string().cuid().nullable().optional(),
  quantidade: z.number().positive().max(100000).optional(),
  valor: z.number().min(0).optional(),
  notaFiscal: z.string().max(50).optional(),
  followUpEm: z.coerce.date().optional(),
});
export type UpdateAmostraDto = z.infer<typeof updateAmostraSchema>;

export const changeAmostraStatusSchema = z.object({
  status: z.nativeEnum(AmostraStatus),
  observacao: z.string().max(500).optional(),
});
export type ChangeAmostraStatusDto = z.infer<typeof changeAmostraStatusSchema>;

export const listAmostrasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['enviadoEm', 'followUpEm', 'valor']).default('enviadoEm'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  status: z.nativeEnum(AmostraStatus).optional(),
  clienteId: z.string().cuid().optional(),
  /** Filtra amostras com follow-up vencido (data <= hoje e status != CONVERTIDA/NAO_CONVERTEU) */
  vencidas: z.coerce.boolean().optional(),
});
export type ListAmostrasDto = z.infer<typeof listAmostrasSchema>;
