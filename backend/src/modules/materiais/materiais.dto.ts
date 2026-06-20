import { z } from 'zod';

/** Tipos padrão quando o tenant não configurou Empresa.config.materiaisVenda.tipos. */
export const DEFAULT_MATERIAIS_TIPOS = [
  { key: 'ficha_tecnica', label: 'Ficha técnica' },
  { key: 'foto_hd', label: 'Foto HD' },
  { key: 'apresentacao', label: 'Apresentação' },
  { key: 'video', label: 'Vídeo' },
  { key: 'certificacao', label: 'Certificação' },
  { key: 'tabela_comercial', label: 'Tabela comercial' },
  { key: 'tutorial', label: 'Tutorial' },
] as const;

export const createMaterialSchema = z.object({
  tipo: z.string().trim().min(1).max(40),
  titulo: z.string().trim().min(2).max(200),
  descricao: z.string().trim().max(1000).optional(),
  produtoId: z.string().cuid().optional(),
  categoria: z.string().trim().max(100).optional(),
  confidencial: z.coerce.boolean().optional(),
});
export type CreateMaterialDto = z.infer<typeof createMaterialSchema>;

export const updateMaterialSchema = z.object({
  tipo: z.string().trim().min(1).max(40).optional(),
  titulo: z.string().trim().min(2).max(200).optional(),
  descricao: z.string().trim().max(1000).nullable().optional(),
  produtoId: z.string().cuid().nullable().optional(),
  categoria: z.string().trim().max(100).nullable().optional(),
  confidencial: z.coerce.boolean().optional(),
});
export type UpdateMaterialDto = z.infer<typeof updateMaterialSchema>;

export const listMateriaisSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  tipo: z.string().optional(),
  produtoId: z.string().optional(),
  search: z.string().optional(),
});
export type ListMateriaisDto = z.infer<typeof listMateriaisSchema>;
