import { z } from 'zod';

const channelEnum = z.enum([
  'WHATSAPP',
  'INSTAGRAM',
  'FACEBOOK',
  'EMAIL',
  'MARKETPLACE_ML',
  'MARKETPLACE_SHOPEE',
  'MARKETPLACE_AMAZON',
  'MARKETPLACE_TIKTOK',
]);

const statusEnum = z.enum(['ABERTA', 'PENDENTE', 'RESOLVIDA', 'ARQUIVADA']);

export const listConversationsSchema = z.object({
  canal: channelEnum.optional(),
  status: statusEnum.optional(),
  atribuidoId: z.string().cuid().optional(),
  /** "me" → filtra atribuído ao usuário atual. */
  meu: z.coerce.boolean().optional(),
  /** true → apenas não atribuídas. */
  naoAtribuidas: z.coerce.boolean().optional(),
  clienteId: z.string().cuid().optional(),
  search: z.string().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(30),
});
export type ListConversationsDto = z.infer<typeof listConversationsSchema>;

export const listMensagensSchema = z.object({
  /** Antes do criadoEm dessa mensagem (paginação cursor). */
  antesDe: z.string().cuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListMensagensDto = z.infer<typeof listMensagensSchema>;

export const responderSchema = z.object({
  texto: z.string().min(1).max(4096),
});
export type ResponderDto = z.infer<typeof responderSchema>;

export const atribuirSchema = z.object({
  /** null pra desatribuir. */
  atribuidoId: z.string().cuid().nullable(),
});
export type AtribuirDto = z.infer<typeof atribuirSchema>;

export const alterarStatusSchema = z.object({
  status: statusEnum,
});
export type AlterarStatusDto = z.infer<typeof alterarStatusSchema>;
