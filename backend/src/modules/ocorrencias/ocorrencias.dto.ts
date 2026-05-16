import { OcorrenciaStatus, OcorrenciaTipo } from '@prisma/client';
import { z } from 'zod';

const SLA_HORAS_POR_SEVERIDADE: Record<string, number> = {
  baixa: 72,
  media: 48,
  alta: 24,
  critica: 4,
};

export const severidadeSchema = z.enum(['baixa', 'media', 'alta', 'critica']);

export const createOcorrenciaSchema = z.object({
  clienteId: z.string().cuid(),
  pedidoId: z.string().cuid().optional(),
  responsavelId: z.string().cuid().optional(),
  tipo: z.nativeEnum(OcorrenciaTipo),
  severidade: severidadeSchema.default('media'),
  titulo: z.string().trim().min(3).max(200),
  descricao: z.string().min(3).max(5000),
  /** Override do SLA padrão por severidade */
  slaHoras: z.number().int().min(1).max(720).optional(),
});
export type CreateOcorrenciaDto = z.infer<typeof createOcorrenciaSchema>;

export const updateOcorrenciaSchema = z.object({
  titulo: z.string().min(3).max(200).optional(),
  descricao: z.string().min(3).max(5000).optional(),
  severidade: severidadeSchema.optional(),
  tipo: z.nativeEnum(OcorrenciaTipo).optional(),
  responsavelId: z.string().cuid().nullable().optional(),
});
export type UpdateOcorrenciaDto = z.infer<typeof updateOcorrenciaSchema>;

export const resolverSchema = z.object({
  resolucao: z.string().min(3).max(5000),
});
export type ResolverDto = z.infer<typeof resolverSchema>;

export const changeStatusOcorrenciaSchema = z.object({
  status: z.nativeEnum(OcorrenciaStatus),
  motivo: z.string().max(500).optional(),
});
export type ChangeStatusOcorrenciaDto = z.infer<typeof changeStatusOcorrenciaSchema>;

export const adicionarComentarioSchema = z.object({
  texto: z.string().trim().min(1).max(2000),
});
export type AdicionarComentarioDto = z.infer<typeof adicionarComentarioSchema>;

export const listOcorrenciasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['criadoEm', 'slaVenceEm', 'severidade']).default('criadoEm'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  status: z.nativeEnum(OcorrenciaStatus).optional(),
  tipo: z.nativeEnum(OcorrenciaTipo).optional(),
  severidade: severidadeSchema.optional(),
  clienteId: z.string().cuid().optional(),
  responsavelId: z.string().cuid().optional(),
  /** Filtra apenas ocorrências com SLA vencido (não resolvidas) */
  slaEstourado: z.coerce.boolean().optional(),
});
export type ListOcorrenciasDto = z.infer<typeof listOcorrenciasSchema>;

export function slaHorasParaSeveridade(severidade: string): number {
  return SLA_HORAS_POR_SEVERIDADE[severidade] ?? 48;
}
