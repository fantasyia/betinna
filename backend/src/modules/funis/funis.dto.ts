import { FunilEtapaTipo } from '@prisma/client';
import { z } from 'zod';

/** Cor em hex 6-char. */
const corSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor precisa ser hex de 6 dígitos (ex: #201554)');

export const createFunilEtapaSchema = z.object({
  nome: z.string().trim().min(1, 'Nome da etapa obrigatório').max(60),
  cor: corSchema.default('#7c3aed'),
  ordem: z.number().int().min(0).default(0),
  tipo: z.nativeEnum(FunilEtapaTipo).default('ATIVA'),
  probabilidade: z.number().int().min(0).max(100).default(50),
  slaDias: z.number().int().min(1).max(365).nullable().optional(),
});
export type CreateFunilEtapaDto = z.infer<typeof createFunilEtapaSchema>;

export const updateFunilEtapaSchema = createFunilEtapaSchema.partial();
export type UpdateFunilEtapaDto = z.infer<typeof updateFunilEtapaSchema>;

export const createFunilSchema = z.object({
  nome: z.string().trim().min(1, 'Nome do funil obrigatório').max(100),
  descricao: z.string().max(500).optional(),
  cor: corSchema.default('#201554'),
  ordem: z.number().int().min(0).default(0),
  ativo: z.boolean().default(true),
  isPadrao: z.boolean().default(false),
  /**
   * Etapas iniciais (opcional). Quando omitido, o funil é criado SEM etapas
   * e o usuário adiciona via POST /funis/:id/etapas. Quando informado, cria
   * em batch dentro de uma transaction.
   */
  etapas: z.array(createFunilEtapaSchema).optional(),
});
export type CreateFunilDto = z.infer<typeof createFunilSchema>;

export const updateFunilSchema = createFunilSchema.omit({ etapas: true }).partial();
export type UpdateFunilDto = z.infer<typeof updateFunilSchema>;

/** Reordena etapas em batch (passa lista completa de ids na ordem desejada). */
export const reordenarEtapasSchema = z.object({
  etapaIds: z.array(z.string().cuid()).min(1),
});
export type ReordenarEtapasDto = z.infer<typeof reordenarEtapasSchema>;
