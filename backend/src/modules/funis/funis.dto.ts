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
  /** SLA em horas (Fase C). Precedência sobre slaDias quando setado. */
  slaHoras: z.number().int().min(1).max(8760).nullable().optional(),
  /** Ação quando o SLA da etapa vence (orquestração Fase B). */
  acaoSlaExpirado: z
    .object({
      tipo: z.enum(['notificar', 'mover', 'tag']),
      etapaDestinoId: z.string().min(1).optional(), // tipo=mover
      tagNome: z.string().min(1).max(60).optional(), // tipo=tag
    })
    .nullable()
    .optional(),
  /** Teto de leads simultâneos na etapa (anti-sobrecarga). */
  capacidadeMaxima: z.number().int().min(1).max(100000).nullable().optional(),
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
  /** Funil obrigatório/protegido — só ADMIN/DIRETOR liga; REP não edita/exclui. */
  protegido: z.boolean().optional(),
  /** Allow-list de tags permitidas no funil (Fase C). null = todas. */
  tagsPermitidas: z.array(z.string().trim().min(1)).nullable().optional(),
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
  // F1-irmão (Lote 8): não valida `.cuid()` — etapas do funil padrão criado
  // pela migration usam id `fet_<hash>` (não-cuid). O service valida que as
  // etapas pertencem ao funil. `.cuid()` rejeitava com "Dados inválidos".
  etapaIds: z.array(z.string().min(1)).min(1),
});
export type ReordenarEtapasDto = z.infer<typeof reordenarEtapasSchema>;
