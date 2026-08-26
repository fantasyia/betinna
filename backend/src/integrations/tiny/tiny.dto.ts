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
        // 1 envelope · 2 pacote/caixa · 3 rolo/cilindro (valores do Tiny).
        embalagemTipo: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        embalagemId: z.number().int().positive().optional(),
        // Estrutura do fabricado: presente = o produto passa a aceitar OP.
        componentes: z
          .array(z.object({ sku: z.string().min(1).max(60), quantidade: z.number().positive() }))
          .max(200)
          .optional(),
        etapas: z.array(z.string().min(1).max(120)).max(50).optional(),
      }),
    )
    .min(1)
    .max(200),
});

export type ImportarProdutosDto = z.infer<typeof importarProdutosSchema>;
