import { CanalOrigem, LeadEtapa } from '@prisma/client';
import { z } from 'zod';
import { normalizarTelefoneIntl } from '@shared/validators/br-validators';

export const createLeadSchema = z.object({
  nome: z.string().trim().min(2).max(200),
  cidade: z.string().max(100).optional(),
  uf: z.string().length(2).optional(),
  segmento: z.string().max(60).optional(),
  contatoNome: z.string().max(150).optional(),
  contatoEmail: z.string().email().optional(),
  // Telefone do lead (opcional, dado às vezes imperfeito de prospecção): normaliza
  // pra E.164 quando dá pra validar; senão mantém como veio (não rejeita o lead).
  contatoTelefone: z
    .string()
    .max(30)
    .optional()
    .transform((v) => (v ? (normalizarTelefoneIntl(v) ?? v) : v)),
  valorEstimado: z.number().min(0).default(0),
  canalOrigem: z.nativeEnum(CanalOrigem).default('WHATSAPP'),
  etapa: z.nativeEnum(LeadEtapa).default('NOVO'),
  /** Funil customizado. Se omitido, usa o funil padrão da empresa.
   *  NÃO valida `.cuid()`: o funil padrão criado pela migration usa ids no
   *  formato `funil_<hash>` (não-cuid). O service valida existência + tenant. */
  funilId: z.string().min(1).optional(),
  /** Etapa específica dentro do funil. Se omitida, usa a 1ª etapa ATIVA.
   *  Idem funilId: etapas legadas usam ids `fet_<hash>` (não-cuid). */
  funilEtapaId: z.string().min(1).optional(),
  score: z.number().int().min(0).max(100).default(50),
  proximaAcao: z.string().max(300).optional(),
  observacoes: z.string().max(2000).optional(),
  representanteId: z.string().cuid().optional(),
  /** Cria o lead SEM funil (funilId/funilEtapaId nulos) — vira "contato solto"
   *  que NÃO é trabalhado por nenhum funil/cron. Usado na importação de base fria.
   *  Tem precedência sobre funilId/funilEtapaId. */
  semFunil: z.boolean().optional(),
});
export type CreateLeadDto = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = createLeadSchema.partial().omit({ etapa: true });
export type UpdateLeadDto = z.infer<typeof updateLeadSchema>;

/**
 * Mover etapa aceita 2 formatos (XOR):
 *  - `etapa: LeadEtapa` (enum legado — funil padrão)
 *  - `funilEtapaId: cuid` (funil customizado — fonte da verdade)
 *
 * Backend resolve qual usar: se `funilEtapaId` vier, ignora `etapa` e
 * deriva o enum a partir do `tipo` da FunilEtapa pra manter compat.
 *
 * `motivo` é obrigatório só quando a etapa destino for terminal
 * (GANHO ou PERDIDO no enum legado, ou tipo GANHO/PERDIDO no funil custom).
 */
export const moverEtapaSchema = z
  .object({
    etapa: z.nativeEnum(LeadEtapa).optional(),
    // F1 (Lote 8): não valida `.cuid()` — etapas do funil padrão criado pela
    // migration têm id `fet_<hash>` (não-cuid). O service valida que a etapa
    // existe e pertence à empresa. `.cuid()` aqui rejeitava com "Dados inválidos".
    funilEtapaId: z.string().min(1).optional(),
    motivo: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.etapa && !data.funilEtapaId) {
      ctx.addIssue({
        code: 'custom',
        path: ['etapa'],
        message: 'Informe `etapa` (enum) ou `funilEtapaId` (custom)',
      });
    }
    // Motivo obrigatório só pro enum legado — quando vem funilEtapaId, o
    // backend valida usando o tipo da etapa (no service).
    if (data.etapa && (data.etapa === 'GANHO' || data.etapa === 'PERDIDO') && !data.motivo) {
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

/** Query do histórico de etapas (MCP etapa_historico) — filtro funil/lead/período. */
export const historicoEtapasQuerySchema = z.object({
  funilId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  /** Período (ISO) sobre `ocorridoEm`. */
  de: z.string().datetime().optional(),
  ate: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type HistoricoEtapasQueryDto = z.infer<typeof historicoEtapasQuerySchema>;

export const adicionarTagLeadSchema = z.object({
  tagId: z.string().min(1),
});
export type AdicionarTagLeadDto = z.infer<typeof adicionarTagLeadSchema>;
