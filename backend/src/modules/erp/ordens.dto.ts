import { z } from 'zod';

/** ERP próprio · entrega 4 — ordem de produção. */

const id = z.string().min(1).max(40);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const semRepetir = <T extends { produtoId?: string; insumoId?: string }>(xs: T[]) =>
  new Set(xs.map((x) => x.produtoId ?? x.insumoId)).size === xs.length;

/** Grade da OP: quantas peças de cada variação (cor × linha × tamanho). */
const gradeSchema = z
  .array(z.object({ produtoId: id, quantidade: z.number().int().min(1).max(100_000) }))
  .min(1, 'Monte a grade da OP')
  .max(2000)
  .refine(semRepetir, 'Variação repetida na grade');

export const simularOpSchema = z.object({
  modeloId: id,
  faccaoId: id.nullable().optional(),
  itens: gradeSchema,
});
export type SimularOpDto = z.infer<typeof simularOpSchema>;

export const criarOpSchema = simularOpSchema.extend({
  prazo: z.coerce.date().nullable().optional(),
  observacoes: textoOpcional(1000),
});
export type CriarOpDto = z.infer<typeof criarOpSchema>;

const consumoSchema = z
  .array(z.object({ insumoId: id, quantidade: z.number().positive().max(1_000_000) }))
  .max(100)
  .refine(semRepetir, 'Insumo repetido');

/** Corte: tecido realmente gasto e peças cortadas por variação. */
export const corteSchema = z.object({
  tecidos: consumoSchema,
  itens: z
    .array(z.object({ produtoId: id, cortada: z.number().int().min(0).max(100_000) }))
    .min(1)
    .refine(semRepetir, 'Variação repetida'),
});
export type CorteDto = z.infer<typeof corteSchema>;

/** Envio pra facção: peças enviadas, aviamentos que saíram e o preço por peça. */
export const envioSchema = z.object({
  faccaoId: id,
  /** Vazio = usa a tabela da facção pra este modelo. */
  precoPorPeca: z.number().nonnegative().max(100_000).nullable().optional(),
  itens: z
    .array(z.object({ produtoId: id, enviada: z.number().int().min(0).max(100_000) }))
    .min(1)
    .refine(semRepetir, 'Variação repetida'),
  aviamentos: consumoSchema,
  prazo: z.coerce.date().nullable().optional(),
});
export type EnvioDto = z.infer<typeof envioSchema>;

/** Uma entrega da facção (pode haver várias). */
export const recebimentoSchema = z.object({
  itens: z
    .array(
      z.object({
        produtoId: id,
        quantidade: z.number().int().min(0).max(100_000),
        defeito: z.number().int().min(0).max(100_000).default(0),
      }),
    )
    .min(1)
    .refine(semRepetir, 'Variação repetida')
    .refine((xs) => xs.some((x) => x.quantidade + x.defeito > 0), 'Nenhuma peça nesta entrega'),
});
export type RecebimentoDto = z.infer<typeof recebimentoSchema>;
