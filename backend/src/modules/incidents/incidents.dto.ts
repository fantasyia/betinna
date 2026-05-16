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

const tipoEnum = z.enum([
  'RECLAMACAO',
  'DEVOLUCAO',
  'MEDIACAO',
  'DISPUTA',
  'CANCELAMENTO',
]);

const statusEnum = z.enum([
  'ABERTO',
  'AGUARDANDO_VENDEDOR',
  'AGUARDANDO_COMPRADOR',
  'EM_MEDIACAO',
  'RESOLVIDO',
  'EXPIRADO',
  'CANCELADO',
]);

export const listIncidentsSchema = z.object({
  canal: channelEnum.optional(),
  tipo: tipoEnum.optional(),
  status: statusEnum.optional(),
  clienteId: z.string().cuid().optional(),
  /** True: só aguardando ação nossa (AGUARDANDO_VENDEDOR ou ABERTO sem prazo expirado). */
  aguardandoMim: z.coerce.boolean().optional(),
  /** True: incidentes com prazo expirando nas próximas 24h. */
  prazoUrgente: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(30),
});
export type ListIncidentsDto = z.infer<typeof listIncidentsSchema>;
