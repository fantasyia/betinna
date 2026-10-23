import { z } from 'zod';

/** Etiquetas de código de barras (20/10): peças × quantidade, no formato do rolo. */
export const etiquetasSchema = z
  .object({
    formato: z.enum(['40x80', '50x30']),
    itens: z
      .array(
        z.object({
          produtoId: z.string().min(1).max(40),
          quantidade: z.number().int().min(1).max(2000),
        }),
      )
      .min(1, 'Escolha ao menos uma peça')
      .max(500),
    /** Data impressa (AAAA-MM-DD). Ausente = hoje. */
    data: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((d) => d.itens.reduce((s, i) => s + i.quantidade, 0) <= 5000, {
    message: 'No máximo 5.000 etiquetas por PDF',
  });
export type EtiquetasDto = z.infer<typeof etiquetasSchema>;
