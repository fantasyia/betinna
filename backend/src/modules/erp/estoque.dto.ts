import { z } from 'zod';

/**
 * Ajuste manual de estoque (inventário, correção) ou devolução. Saldo nunca é
 * editado: isto CRIA um movimento, com motivo obrigatório e quem fez.
 */
export const ajusteEstoqueSchema = z
  .object({
    produtoId: z.string().min(1).max(40),
    tipo: z.enum(['AJUSTE', 'DEVOLUCAO']),
    /** Com sinal: + entra, − sai. Nunca zero. */
    quantidade: z
      .number()
      .int()
      .min(-100_000)
      .max(100_000)
      .refine((v) => v !== 0, 'Quantidade não pode ser zero'),
    motivo: z.string().trim().min(3, 'Diga o motivo do ajuste').max(300),
  })
  .refine((d) => d.tipo !== 'DEVOLUCAO' || d.quantidade > 0, {
    message: 'Devolução sempre entra no estoque (quantidade positiva)',
    path: ['quantidade'],
  });
export type AjusteEstoqueDto = z.infer<typeof ajusteEstoqueSchema>;

export const movimentosQuerySchema = z.object({
  produtoId: z.string().min(1).max(40).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
});
export type MovimentosQueryDto = z.infer<typeof movimentosQuerySchema>;
