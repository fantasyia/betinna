import { z } from 'zod';

export const createProdutoSchema = z.object({
  codigoOmie: z.string().trim().max(50).optional(),
  sku: z.string().trim().max(50).optional(),
  nome: z.string().trim().min(2).max(200),
  descricao: z.string().max(5000).optional(),
  marca: z.string().max(100).optional(),
  linha: z.string().max(60).optional(),
  categoria: z.string().max(60).optional(),
  unidade: z.string().max(40).optional(),
  precoTabela: z.number().positive(),
  precoFabrica: z.number().positive(),
  imagem: z.string().max(500).optional(),
  popularidade: z.number().int().min(0).max(100).default(0),
  estoque: z.number().int().min(0).default(0),
  ativo: z.boolean().default(true),
});
export type CreateProdutoDto = z.infer<typeof createProdutoSchema>;

export const updateProdutoSchema = createProdutoSchema.partial();
export type UpdateProdutoDto = z.infer<typeof updateProdutoSchema>;

export const listProdutosSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['nome', 'criadoEm', 'precoTabela', 'popularidade', 'estoque']).default('nome'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().optional(),
  linha: z.string().optional(),
  categoria: z.string().optional(),
  marca: z.string().optional(),
  ativo: z.coerce.boolean().optional(),
  semEstoque: z.coerce.boolean().optional(),
  precoMin: z.coerce.number().min(0).optional(),
  precoMax: z.coerce.number().min(0).optional(),
});
export type ListProdutosDto = z.infer<typeof listProdutosSchema>;

export const updateEstoqueSchema = z.object({
  estoque: z.number().int().min(0),
});
export type UpdateEstoqueDto = z.infer<typeof updateEstoqueSchema>;

export const ativarSchema = z.object({
  ativo: z.boolean(),
});
export type AtivarDto = z.infer<typeof ativarSchema>;
