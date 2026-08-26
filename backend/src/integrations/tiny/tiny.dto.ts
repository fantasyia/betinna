import { z } from 'zod';

/**
 * Importação de catálogo pro Tiny.
 *
 * Os campos fiscais (NCM, origem, CEST) NÃO entram aqui de propósito: são
 * definidos pela contabilidade e um valor errado vira problema fiscal, não bug.
 * O mesmo vale pro custo — sem dado real, o campo não é enviado.
 */
export const importarProdutosSchema = z.object({
  produtos: z
    .array(
      z.object({
        sku: z.string().min(1).max(60),
        descricao: z.string().min(1).max(200),
        tipo: z.enum(['K', 'S', 'V', 'F', 'M']).optional(),
        unidade: z.string().max(10).optional(),
        fichaTecnica: z.string().max(4000).optional(),
        preco: z.number().nonnegative().optional(),
        precoCusto: z.number().nonnegative().optional(),
        comprimentoCm: z.number().positive().optional(),
        larguraCm: z.number().positive().optional(),
        alturaCm: z.number().positive().optional(),
        pesoKg: z.number().positive().optional(),
        sobEncomenda: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export type ImportarProdutosDto = z.infer<typeof importarProdutosSchema>;
