import { CanalOrigem, LeadEtapa } from '@prisma/client';
import { z } from 'zod';

export const createLeadSchema = z.object({
  nome: z.string().trim().min(2).max(200),
  cidade: z.string().max(100).optional(),
  uf: z.string().length(2).optional(),
  segmento: z.string().max(60).optional(),
  contatoNome: z.string().max(150).optional(),
  contatoEmail: z.string().email().optional(),
  contatoTelefone: z.string().max(30).optional(),
  valorEstimado: z.number().min(0).default(0),
  canalOrigem: z.nativeEnum(CanalOrigem).default('WHATSAPP'),
  etapa: z.nativeEnum(LeadEtapa).default('NOVO'),
  score: z.number().int().min(0).max(100).default(50),
  proximaAcao: z.string().max(300).optional(),
  observacoes: z.string().max(2000).optional(),
  representanteId: z.string().cuid().optional(),
});
export type CreateLeadDto = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = createLeadSchema.partial().omit({ etapa: true });
export type UpdateLeadDto = z.infer<typeof updateLeadSchema>;

export const moverEtapaSchema = z
  .object({
    etapa: z.nativeEnum(LeadEtapa),
    motivo: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.etapa === 'GANHO' || data.etapa === 'PERDIDO') && !data.motivo) {
      ctx.addIssue({
        code: 'custom',
        path: ['motivo'],
        message: 'Motivo é obrigatório ao marcar como GANHO ou PERDIDO',
      });
    }
  });
export type MoverEtapaDto = z.infer<typeof moverEtapaSchema>;

export const listLeadsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['criadoEm', 'valorEstimado', 'score', 'etapaDesde']).default('criadoEm'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  etapa: z.nativeEnum(LeadEtapa).optional(),
  canalOrigem: z.nativeEnum(CanalOrigem).optional(),
  representanteId: z.string().cuid().optional(),
  /** Filtra leads em aging (passou do SLA na etapa atual) */
  aging: z.coerce.boolean().optional(),
});
export type ListLeadsDto = z.infer<typeof listLeadsSchema>;

export const atribuirRepSchema = z.object({
  representanteId: z.string().cuid().nullable(),
});
export type AtribuirRepDto = z.infer<typeof atribuirRepSchema>;
