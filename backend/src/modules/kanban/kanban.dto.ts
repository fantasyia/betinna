import { z } from 'zod';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// ─── Boards ───────────────────────────────────────────────────────────

export const createBoardSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(100),
  descricao: z.string().trim().max(2000).optional(),
  corFundo: z.string().regex(HEX_COLOR, 'Cor deve estar no formato #RRGGBB').default('#0079BF'),
});
export type CreateBoardDto = z.infer<typeof createBoardSchema>;

export const updateBoardSchema = createBoardSchema.partial();
export type UpdateBoardDto = z.infer<typeof updateBoardSchema>;

export const addBoardMembroSchema = z.object({
  usuarioId: z.string().min(1, 'usuarioId é obrigatório'),
});
export type AddBoardMembroDto = z.infer<typeof addBoardMembroSchema>;

// ─── Listas ───────────────────────────────────────────────────────────

export const createListaSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(100),
});
export type CreateListaDto = z.infer<typeof createListaSchema>;

export const updateListaSchema = z.object({
  nome: z.string().trim().min(1).max(100).optional(),
  arquivada: z.boolean().optional(),
});
export type UpdateListaDto = z.infer<typeof updateListaSchema>;

export const moverListaSchema = z.object({
  posicao: z.number().finite().positive(),
});
export type MoverListaDto = z.infer<typeof moverListaSchema>;

// ─── Cards ────────────────────────────────────────────────────────────

export const createCardSchema = z.object({
  titulo: z.string().trim().min(1, 'Título é obrigatório').max(200),
  descricao: z.string().trim().max(10000).optional(),
  dataInicio: z.coerce.date().nullable().optional(),
  dataEntrega: z.coerce.date().nullable().optional(),
});
export type CreateCardDto = z.infer<typeof createCardSchema>;

export const updateCardSchema = z.object({
  titulo: z.string().trim().min(1).max(200).optional(),
  descricao: z.string().trim().max(10000).nullable().optional(),
  dataInicio: z.coerce.date().nullable().optional(),
  dataEntrega: z.coerce.date().nullable().optional(),
  concluido: z.boolean().optional(),
  corCapa: z.string().regex(HEX_COLOR, 'Cor deve estar no formato #RRGGBB').nullable().optional(),
  arquivado: z.boolean().optional(),
});
export type UpdateCardDto = z.infer<typeof updateCardSchema>;

export const moverCardSchema = z.object({
  listaId: z.string().min(1, 'listaId é obrigatório'),
  posicao: z.number().finite().positive(),
});
export type MoverCardDto = z.infer<typeof moverCardSchema>;

// ─── Etiquetas ────────────────────────────────────────────────────────

export const createEtiquetaSchema = z.object({
  nome: z.string().trim().max(40).nullable().optional(),
  cor: z.string().regex(HEX_COLOR, 'Cor deve estar no formato #RRGGBB'),
});
export type CreateEtiquetaDto = z.infer<typeof createEtiquetaSchema>;

export const updateEtiquetaSchema = createEtiquetaSchema.partial();
export type UpdateEtiquetaDto = z.infer<typeof updateEtiquetaSchema>;

// ─── Checklists (AVANÇADOS ★: prazo + responsável POR ITEM) ──────────

const checklistItemBaseSchema = z.object({
  texto: z.string().trim().min(1, 'Texto é obrigatório').max(500),
  dataEntrega: z.coerce.date().nullable().optional(),
  responsavelId: z.string().min(1).nullable().optional(),
});

export const createChecklistSchema = z.object({
  titulo: z.string().trim().min(1, 'Título é obrigatório').max(100),
  itens: z.array(checklistItemBaseSchema).max(100).optional(),
});
export type CreateChecklistDto = z.infer<typeof createChecklistSchema>;

export const updateChecklistSchema = z.object({
  titulo: z.string().trim().min(1).max(100).optional(),
  posicao: z.number().finite().positive().optional(),
});
export type UpdateChecklistDto = z.infer<typeof updateChecklistSchema>;

export const createChecklistItemSchema = checklistItemBaseSchema;
export type CreateChecklistItemDto = z.infer<typeof createChecklistItemSchema>;

export const updateChecklistItemSchema = z.object({
  texto: z.string().trim().min(1).max(500).optional(),
  concluido: z.boolean().optional(),
  posicao: z.number().finite().positive().optional(),
  dataEntrega: z.coerce.date().nullable().optional(),
  responsavelId: z.string().min(1).nullable().optional(),
});
export type UpdateChecklistItemDto = z.infer<typeof updateChecklistItemSchema>;

export const meusItensQuerySchema = z.object({
  // z.coerce.boolean em query string trata "false"/"0" como truthy → sempre true.
  // Padrão do repo (notificacoes.dto): union boolean|string + transform → boolean
  // (undefined/ausente → false). Mantém input=output compatível com ZodValidationPipe.
  incluirConcluidos: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});
export type MeusItensQueryDto = z.infer<typeof meusItensQuerySchema>;

// ─── Campos personalizados (★ Custom Fields) ──────────────────────────

export const CAMPO_TIPOS = ['texto', 'numero', 'data', 'checkbox', 'lista_opcoes'] as const;

export const createCampoSchema = z
  .object({
    nome: z.string().trim().min(1, 'Nome é obrigatório').max(60),
    tipo: z.enum(CAMPO_TIPOS),
    opcoes: z.array(z.string().trim().min(1).max(60)).min(1).max(50).optional(),
  })
  .refine((v) => v.tipo !== 'lista_opcoes' || (v.opcoes && v.opcoes.length > 0), {
    message: 'Campo do tipo lista_opcoes exige "opcoes"',
    path: ['opcoes'],
  });
export type CreateCampoDto = z.infer<typeof createCampoSchema>;

export const updateCampoSchema = z.object({
  nome: z.string().trim().min(1).max(60).optional(),
  opcoes: z.array(z.string().trim().min(1).max(60)).min(1).max(50).optional(),
});
export type UpdateCampoDto = z.infer<typeof updateCampoSchema>;

/** Valor é validado por tipo no service (texto/numero/data/checkbox/opção). */
export const setCampoValorSchema = z.object({
  valor: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});
export type SetCampoValorDto = z.infer<typeof setCampoValorSchema>;

// ─── Comentários e anexos ─────────────────────────────────────────────

export const createComentarioSchema = z.object({
  texto: z.string().trim().min(1, 'Comentário vazio').max(5000),
});
export type CreateComentarioDto = z.infer<typeof createComentarioSchema>;

/** Anexo tipo LINK (JSON). Upload de arquivo vai por multipart no mesmo endpoint. */
export const createAnexoLinkSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  url: z.string().trim().url('URL inválida').max(2000),
});
export type CreateAnexoLinkDto = z.infer<typeof createAnexoLinkSchema>;

// ─── Atividades e busca ───────────────────────────────────────────────

export const atividadesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Cursor: retorna atividades ANTERIORES a este instante (ISO). */
  antes: z.coerce.date().optional(),
});
export type AtividadesQueryDto = z.infer<typeof atividadesQuerySchema>;

export const VENCIMENTO_FILTROS = ['vencidos', 'proximos7dias', 'sem_data'] as const;

export const buscaQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  etiqueta: z.string().optional(),
  membro: z.string().optional(),
  vencimento: z.enum(VENCIMENTO_FILTROS).optional(),
});
export type BuscaQueryDto = z.infer<typeof buscaQuerySchema>;

// ─── ★ Views Premium ──────────────────────────────────────────────────

export const calendarioQuerySchema = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato: YYYY-MM')
    .default(() => new Date().toISOString().slice(0, 7)),
});
export type CalendarioQueryDto = z.infer<typeof calendarioQuerySchema>;

// ─── Tokens de API (MCP) ──────────────────────────────────────────────

/** Escopos válidos de um PAT de plataforma (módulos que o token acessa). */
export const API_TOKEN_ESCOPOS = ['kanban', 'fluxos', 'funis', 'contatos', 'crm'] as const;

export const createApiTokenSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(100), // ex: "Claude Code - PC Léo"
  // Escopo opcional; default aplicado no service (['kanban']). Optional evita
  // input≠output no ZodValidationPipe (mesmo cuidado do incluirConcluidos).
  escopo: z.array(z.enum(API_TOKEN_ESCOPOS)).min(1).optional(),
});
export type CreateApiTokenDto = z.infer<typeof createApiTokenSchema>;
