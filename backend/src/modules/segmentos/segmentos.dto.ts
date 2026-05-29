import { z } from 'zod';

/**
 * Estrutura de regras pra segmentação de Clientes.
 *
 * Suporta operadores básicos: eq, neq, gt, gte, lt, lte, in, contains.
 * Lógica top-level: AND / OR.
 *
 * Ex:
 *  {
 *    logic: 'AND',
 *    conditions: [
 *      { campo: 'status', op: 'eq', valor: 'ATIVO' },
 *      { campo: 'prazoPagamento', op: 'gte', valor: 30 }
 *    ]
 *  }
 */
export const FILTRO_CAMPOS = [
  'status',
  'omieStatus',
  'segmento',
  'cidade',
  'uf',
  'regiao',
  'prazoPagamento',
  'limiteCredito',
  'representanteId',
] as const;
export type FiltroCampo = (typeof FILTRO_CAMPOS)[number];

export const FILTRO_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const;
export type FiltroOp = (typeof FILTRO_OPS)[number];

export const conditionSchema = z.object({
  campo: z.enum(FILTRO_CAMPOS),
  op: z.enum(FILTRO_OPS),
  valor: z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]),
});
export type ConditionDto = z.infer<typeof conditionSchema>;

export const regrasSchema = z.object({
  logic: z.enum(['AND', 'OR']).default('AND'),
  conditions: z.array(conditionSchema).min(1).max(20),
});
export type RegrasDto = z.infer<typeof regrasSchema>;

export const upsertSegmentoSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  descricao: z.string().trim().max(500).nullable().optional(),
  regras: regrasSchema,
  cor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#facc15')
    .optional(),
  ativo: z.boolean().default(true),
});
export type UpsertSegmentoDto = z.infer<typeof upsertSegmentoSchema>;

export const previewSchema = z.object({
  regras: regrasSchema,
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type PreviewDto = z.infer<typeof previewSchema>;
