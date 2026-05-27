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

/**
 * Envia mídia através da conversa.
 *
 * - storagePath: bucket whatsapp-media (path retornado por upload anterior)
 * - url: URL pública (use com cautela — pode expirar)
 * - Pelo menos um dos dois é obrigatório
 *
 * Para áudio de voz (PTT), passar tipo=AUDIO + ptt=true.
 */
export const responderMidiaSchema = z
  .object({
    tipo: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']),
    caption: z.string().max(1024).optional(),
    fileName: z.string().max(255).optional(),
    mimetype: z.string().max(120).optional(),
    ptt: z.boolean().optional(),
    storagePath: z.string().max(500).optional(),
    url: z.string().url().max(2000).optional(),
    /**
     * Arquivo enviado direto pelo frontend em base64 (sem upload prévio).
     * Limite ~15MB (12MB no JSON após overhead base64 ≈ 9MB raw).
     * Frontend deve usar `FileReader.readAsDataURL` e tirar o prefixo
     * `data:<mime>;base64,` antes de enviar (manda só a parte base64 pura).
     */
    dataBase64: z.string().max(20_000_000).optional(),
  })
  .refine((d) => Boolean(d.storagePath || d.url || d.dataBase64), {
    message: 'Forneça storagePath, url ou dataBase64',
    path: ['dataBase64'],
  })
  .refine((d) => d.tipo !== 'DOCUMENT' || Boolean(d.fileName), {
    message: 'fileName obrigatório para DOCUMENT',
    path: ['fileName'],
  });
export type ResponderMidiaDto = z.infer<typeof responderMidiaSchema>;

export const atribuirSchema = z.object({
  /** null pra desatribuir. */
  atribuidoId: z.string().cuid().nullable(),
});
export type AtribuirDto = z.infer<typeof atribuirSchema>;

export const alterarStatusSchema = z.object({
  status: statusEnum,
});
export type AlterarStatusDto = z.infer<typeof alterarStatusSchema>;

/**
 * Bulk operations — Sprint atual. SAC/Gerência precisa aplicar ação em N
 * conversations selecionadas (resolver fila, atribuir lote pra um SAC,
 * arquivar antigas).
 *
 * Limite 200 ids por operação — passa disso, frontend faz batches.
 * Limite força paginação consciente e evita locks longos no Postgres.
 */
export const bulkIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

export const bulkAtribuirSchema = bulkIdsSchema.extend({
  atribuidoId: z.string().cuid().nullable(),
});
export type BulkAtribuirDto = z.infer<typeof bulkAtribuirSchema>;

export const bulkAlterarStatusSchema = bulkIdsSchema.extend({
  status: statusEnum,
});
export type BulkAlterarStatusDto = z.infer<typeof bulkAlterarStatusSchema>;

export type BulkIdsDto = z.infer<typeof bulkIdsSchema>;
