import { z } from 'zod';

export const AGENDA_TIPOS = ['VISITA', 'LIGACAO', 'REUNIAO', 'ENTREGA', 'TAREFA'] as const;
export const agendaTipoEnum = z.enum(AGENDA_TIPOS);

const dateLike = z.coerce.date();

export const createAgendaItemSchema = z.object({
  titulo: z.string().min(1).max(200),
  data: dateLike,
  duracao: z.coerce.number().int().positive().max(60 * 24).default(60), // minutos
  tipo: agendaTipoEnum.default('VISITA'),
  observacao: z.string().max(2000).optional(),
  clienteId: z.string().cuid().optional(),
  /** Quando true e o user tem Google Calendar conectado, espelha no Google. */
  espelharGoogle: z.coerce.boolean().default(true),
  /** Convidados opcionais (apenas se espelhar). */
  participantes: z.array(z.object({ email: z.string().email(), nome: z.string().optional() })).optional(),
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
