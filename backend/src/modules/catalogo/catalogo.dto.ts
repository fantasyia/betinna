import { z } from 'zod';

export const upsertCatalogoItemSchema = z.object({
  produtoId: z.string().cuid(),
  /** % de markup aplicado pelo rep sobre o preço de fábrica (0-100) */
  markup: z.number().min(0).max(100).default(0),
});
export type UpsertCatalogoItemDto = z.infer<typeof upsertCatalogoItemSchema>;

export const bulkUpsertCatalogoSchema = z.object({
  itens: z.array(upsertCatalogoItemSchema).min(1).max(500),
});
export type BulkUpsertCatalogoDto = z.infer<typeof bulkUpsertCatalogoSchema>;

export const setMarkupGlobalSchema = z.object({
  markup: z.number().min(0).max(100),
});
export type SetMarkupGlobalDto = z.infer<typeof setMarkupGlobalSchema>;

export const previewParaClienteSchema = z.object({
  clienteId: z.string().cuid(),
});
export type PreviewParaClienteDto = z.infer<typeof previewParaClienteSchema>;

export const shareCatalogSchema = z.object({
  /**
   * Vincular cliente é OPCIONAL.
   *  - Com clienteId: aplica preço negociado do cliente (se houver) + markup do rep.
   *  - Sem clienteId: envio livre — preço tabela × markup do rep (preview "genérico").
   */
  clienteId: z.string().cuid().optional(),
  /**
   * Canal de envio. 'link' foi REMOVIDO (não existia página front pra renderizar
   * o preview público — apontava só pro endpoint JSON do backend).
   */
  canal: z.enum(['whatsapp', 'pdf']),
  validoAte: z.coerce.date().optional(),
});
export type ShareCatalogDto = z.infer<typeof shareCatalogSchema>;
