import { z } from 'zod';
import { boolQuery } from '@shared/validators/query.schema';

export const createKnowledgeSchema = z.object({
  titulo: z.string().trim().min(2).max(160),
  conteudo: z.string().trim().min(2).max(5000),
  categoria: z.string().trim().max(60).optional(),
  ativo: z.boolean().optional(),
});
export type CreateKnowledgeDto = z.infer<typeof createKnowledgeSchema>;

export const updateKnowledgeSchema = createKnowledgeSchema.partial();
export type UpdateKnowledgeDto = z.infer<typeof updateKnowledgeSchema>;

/** Formatos aceitos no upload — os que `extrairTexto` sabe ler. */
export const MIMES_DOCUMENTO = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

/** Upload de documento (PDF/DOCX/TXT/…) pra base de conhecimento. dataBase64 ≤ ~20MB. */
export const createKnowledgeDocumentoSchema = z.object({
  titulo: z.string().trim().min(2).max(160),
  fileName: z.string().trim().min(1).max(255),
  // Só o que a extração trata (officeparser + texto plano). O mimetype vira o
  // Content-Type do objeto no Storage e do arquivo que o bot pode ENVIAR ao lead,
  // então não pode ser string livre (text/html na URL assinada, por exemplo).
  mimetype: z
    .string()
    .trim()
    .toLowerCase()
    .refine((m) => MIMES_DOCUMENTO.has(m), 'Tipo de arquivo não suportado'),
  /** true = o bot pode ENVIAR o arquivo inteiro ao lead (catálogo, tabela de preços). */
  podeEnviar: z.boolean().optional(),
  // base64 cru (~27MB de string = ~20MB de binário).
  dataBase64: z.string().min(1).max(28_000_000),
});
export type CreateKnowledgeDocumentoDto = z.infer<typeof createKnowledgeDocumentoSchema>;

export const updateKnowledgeDocumentoSchema = z
  .object({
    titulo: z.string().trim().min(2).max(160).optional(),
    /** Anexar o ARQUIVO na conversa. */
    podeEnviar: z.boolean().optional(),
    /**
     * Usar o CONTEÚDO como fonte de resposta (liga/desliga todos os trechos).
     * Permissão diferente de `podeEnviar`: um documento interno pode merecer
     * nenhuma das duas, e antes só dava pra controlar a primeira.
     */
    usarComoFonte: z.boolean().optional(),
  })
  .refine(
    (d) => d.titulo !== undefined || d.podeEnviar !== undefined || d.usarComoFonte !== undefined,
    { message: 'Informe titulo, podeEnviar ou usarComoFonte' },
  );
export type UpdateKnowledgeDocumentoDto = z.infer<typeof updateKnowledgeDocumentoSchema>;

/**
 * `incluirDocumentos`: por padrão a lista plana OMITE os trechos derivados de
 * documento — a UI os mostra dentro do card do Documento e dezenas de cards
 * soltos poluiriam a tela. Mas quem pergunta "o que o bot consulta hoje?"
 * (MCP, auditoria) precisa ver TUDO: sem esta opção a resposta era `0 trechos`
 * com a base cheia, que é pior que não ter a listagem.
 */
export const listKnowledgeSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  /** Inclui chunks derivados da config (fonte=CONFIG). Default só os MANUAL. */
  incluirConfig: boolQuery.optional(),
  /** Inclui os trechos derivados de DOCUMENTO (ver docblock acima). */
  incluirDocumentos: boolQuery.optional(),
});
export type ListKnowledgeDto = z.infer<typeof listKnowledgeSchema>;
