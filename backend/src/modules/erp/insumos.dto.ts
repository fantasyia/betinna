import { z } from 'zod';

/** ERP próprio · entrega 2 — matéria-prima (tecido e aviamento). */

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const insumoSchema = z.object({
  nome: z.string().trim().min(2, 'Dê um nome ao insumo').max(120),
  tipo: z.enum(['TECIDO', 'AVIAMENTO']),
  unidade: z.enum(['KG', 'METRO', 'UNIDADE', 'PAR']),
  cor: textoOpcional(60),
  fornecedor: textoOpcional(120),
  estoqueMinimo: z.number().nonnegative().max(1_000_000).nullable().optional(),
  ativo: z.boolean().optional(),
});
export type InsumoDto = z.infer<typeof insumoSchema>;

/** Entrada de compra: quantidade + preço POR UNIDADE (é o que entra no custo médio). */
export const compraInsumoSchema = z.object({
  quantidade: z.number().positive('Quantidade maior que zero').max(1_000_000),
  custoUnitario: z.number().nonnegative().max(1_000_000),
  /** Nº da nota/pedido do fornecedor. */
  documento: textoOpcional(80),
  motivo: textoOpcional(300),
  /** Financeiro: quando a compra vence (AAAA-MM-DD). Sem ele, hoje. */
  vencimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD')
    .nullable()
    .optional(),
  /** Financeiro: valor TOTAL pago (o custo por unidade arredonda; o título usa o exato). */
  valorTotal: z.number().nonnegative().max(100_000_000).nullable().optional(),
});
export type CompraInsumoDto = z.infer<typeof compraInsumoSchema>;

/**
 * Movimento manual. PERDA e SOBRA_RETORNO recebem a quantidade POSITIVA (o
 * sinal vem do tipo); AJUSTE recebe com sinal (+ entra, − sai). Motivo sempre.
 */
export const movimentoInsumoSchema = z
  .object({
    tipo: z.enum(['PERDA', 'SOBRA_RETORNO', 'AJUSTE']),
    quantidade: z
      .number()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((v) => v !== 0, 'Quantidade não pode ser zero'),
    motivo: z.string().trim().min(3, 'Diga o motivo').max(300),
    documento: textoOpcional(80),
  })
  .refine((d) => d.tipo === 'AJUSTE' || d.quantidade > 0, {
    message: 'Perda e sobra vão com a quantidade positiva',
    path: ['quantidade'],
  });
export type MovimentoInsumoDto = z.infer<typeof movimentoInsumoSchema>;
