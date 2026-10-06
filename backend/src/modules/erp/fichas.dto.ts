import { z } from 'zod';

/** ERP próprio · entrega 3 — ficha técnica (por modelo × linha) e facções. */

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

/** Ficha da grade: SUBSTITUI a lista de insumos inteira (é como a tela edita). */
export const fichaSchema = z.object({
  custoFaccaoPrevisto: z.number().nonnegative().max(100_000).nullable().optional(),
  observacoes: textoOpcional(1000),
  itens: z
    .array(
      z.object({
        insumoId: z.string().min(1).max(40),
        consumoPorPeca: z.number().positive('Consumo maior que zero').max(100_000),
        observacao: textoOpcional(200),
      }),
    )
    .max(100)
    .refine((xs) => new Set(xs.map((x) => x.insumoId)).size === xs.length, {
      message: 'Insumo repetido na ficha — some o consumo numa linha só',
    }),
});
export type FichaDto = z.infer<typeof fichaSchema>;

export const faccaoSchema = z.object({
  nome: z.string().trim().min(2, 'Dê um nome à facção').max(120),
  contato: textoOpcional(120),
  telefone: textoOpcional(30),
  especialidade: textoOpcional(200),
  observacoes: textoOpcional(1000),
  ativo: z.boolean().optional(),
});
export type FaccaoDto = z.infer<typeof faccaoSchema>;

/** Preço por peça POR MODELO — substitui a tabela da facção inteira. */
export const precosFaccaoSchema = z.object({
  precos: z
    .array(
      z.object({
        modeloId: z.string().min(1).max(40),
        precoPorPeca: z.number().nonnegative().max(100_000),
      }),
    )
    .max(500)
    .refine((xs) => new Set(xs.map((x) => x.modeloId)).size === xs.length, {
      message: 'Modelo repetido na tabela da facção',
    }),
});
export type PrecosFaccaoDto = z.infer<typeof precosFaccaoSchema>;
