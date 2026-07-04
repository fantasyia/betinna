import { z } from 'zod';

export const AGENDA_TIPOS = ['VISITA', 'LIGACAO', 'REUNIAO', 'ENTREGA', 'TAREFA'] as const;
export const agendaTipoEnum = z.enum(AGENDA_TIPOS);

export const RECORRENCIAS = [
  'NENHUMA',
  'DIARIA',
  'SEMANAL',
  'QUINZENAL',
  'MENSAL',
  'ANUAL',
] as const;
export const recorrenciaEnum = z.enum(RECORRENCIAS);

const dateLike = z.coerce.date();

export const createAgendaItemSchema = z.object({
  titulo: z.string().min(1).max(200),
  data: dateLike,
  duracao: z.coerce
    .number()
    .int()
    .positive()
    .max(60 * 24)
    .default(60), // minutos
  tipo: agendaTipoEnum.default('VISITA'),
  observacao: z.string().max(2000).optional(),
  /** Local/endereço do compromisso → `location` no Google Calendar. */
  local: z.string().max(300).optional(),
  /**
   * Alertas/lembretes em MINUTOS antes do início (ex.: [10, 60, 1440]).
   * → `reminders.overrides` (popup) no Google. Máx 5, 0..40320min (4 semanas, teto do Google).
   */
  alertas: z.array(z.coerce.number().int().min(0).max(40320)).max(5).optional(),
  clienteId: z.string().cuid().optional(),
  /** Quando true e o user tem Google Calendar conectado, espelha no Google. */
  espelharGoogle: z.coerce.boolean().default(true),
  /** Convidados opcionais (apenas se espelhar). */
  participantes: z
    .array(z.object({ email: z.string().email(), nome: z.string().optional() }))
    .optional(),
  /** v1.5.0 — Recorrência. Default NENHUMA = item único. */
  recorrencia: recorrenciaEnum.default('NENHUMA'),
  /**
   * v1.5.0 — Quantas ocorrências gerar (incluindo a primeira).
   * Default 12. Ignorado quando recorrencia=NENHUMA.
   */
  recorrenciaOcorrencias: z.coerce.number().int().min(1).max(52).default(12),
});
export type CreateAgendaItemDto = z.infer<typeof createAgendaItemSchema>;

export const updateAgendaItemSchema = createAgendaItemSchema.partial();
export type UpdateAgendaItemDto = z.infer<typeof updateAgendaItemSchema>;

export const listAgendaSchema = z.object({
  inicio: dateLike.optional(),
  fim: dateLike.optional(),
  clienteId: z.string().cuid().optional(),
  tipo: agendaTipoEnum.optional(),
  /** Listar agenda de outro usuário (apenas ADMIN/GERENTE). Default: o próprio. */
  usuarioId: z.string().cuid().optional(),
});
export type ListAgendaDto = z.infer<typeof listAgendaSchema>;

/** Faixa pra ler os eventos do Google Calendar do usuário (overlay read-only). */
export const googleEventosSchema = z.object({
  inicio: dateLike,
  fim: dateLike,
});
export type GoogleEventosQuery = z.infer<typeof googleEventosSchema>;
