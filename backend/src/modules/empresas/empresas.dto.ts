import { z } from 'zod';

export const createEmpresaSchema = z.object({
  nome: z.string().min(2).max(200),
  cnpj: z
    .string()
    .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, 'CNPJ deve seguir o formato 00.000.000/0001-00')
    .optional(),
  ramo: z.string().max(100).optional(),
  cidade: z.string().max(100).optional(),
  uf: z.string().length(2).optional(),
  subtitulo: z.string().max(200).optional(),
  plano: z.enum(['Free', 'Pro', 'Enterprise']).default('Pro'),
  // B1 (Lote 6) — Desconto à vista automático (0 = desligado). Máx 50%.
  // Aplicado em PIX (descontoPixPct) e BOLETO+condição=avista (descontoBoletoAvistaPct).
  descontoPixPct: z.number().min(0).max(50).optional(),
  descontoBoletoAvistaPct: z.number().min(0).max(50).optional(),
  // Fase 2 — liga/desliga global do bot Muller no WhatsApp da empresa.
  botWhatsappAtivo: z.boolean().optional(),
});

export type CreateEmpresaDto = z.infer<typeof createEmpresaSchema>;

export const updateEmpresaSchema = createEmpresaSchema.partial();
export type UpdateEmpresaDto = z.infer<typeof updateEmpresaSchema>;

export const listEmpresasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  ativo: z.coerce.boolean().optional(),
});
export type ListEmpresasDto = z.infer<typeof listEmpresasSchema>;
