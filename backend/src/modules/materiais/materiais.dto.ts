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

/**
 * O upload é multipart: TODO campo chega como STRING. `z.coerce.boolean()` faz
 * `Boolean("false") === true`, então todo material subido pela UI virava
 * confidencial. Aqui só o literal "true" é verdadeiro — mais estrito que o
 * `boolQuery` de query string (@shared/validators/query.schema), de propósito:
 * checkbox de formulário só manda "true" ou nada.
 */
const booleanoDeFormulario = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : v),
  z.boolean(),
);

export const createMaterialSchema = z.object({
  tipo: z.string().trim().min(1).max(40),
  titulo: z.string().trim().min(2).max(200),
  descricao: z.string().trim().max(1000).optional(),
  produtoId: z.string().cuid().optional(),
  categoria: z.string().trim().max(100).optional(),
  confidencial: booleanoDeFormulario.optional(),
});
export type CreateMaterialDto = z.infer<typeof createMaterialSchema>;

export const updateMaterialSchema = z.object({
  tipo: z.string().trim().min(1).max(40).optional(),
  titulo: z.string().trim().min(2).max(200).optional(),
  descricao: z.string().trim().max(1000).nullable().optional(),
  produtoId: z.string().cuid().nullable().optional(),
  categoria: z.string().trim().max(100).nullable().optional(),
  // PATCH é JSON (boolean de verdade), mas aceita string por segurança —
  // manter o coerce aqui deixava a mesma armadilha armada.
  confidencial: booleanoDeFormulario.optional(),
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
