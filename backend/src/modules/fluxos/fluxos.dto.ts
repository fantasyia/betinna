import { z } from 'zod';

// ─── Enums sync com Prisma ────────────────────────────────────────────
export const fluxoStatusValues = ['RASCUNHO', 'ATIVO', 'PAUSADO', 'ARQUIVADO'] as const;
export const fluxoNoTipoValues = ['TRIGGER', 'CONDICAO', 'ACAO', 'DELAY'] as const;
// ⚠️ MANTER SINCRONIZADO com o enum FluxoTriggerTipo do Prisma (schema.prisma).
export const fluxoTriggerTipoValues = [
  'LEAD_CRIADO',
  'LEAD_ETAPA_MUDOU',
  'PEDIDO_APROVADO',
  'PEDIDO_ENTREGUE',
  'OCORRENCIA_ABERTA',
  'CLIENTE_INATIVO_30D',
  'AMOSTRA_FOLLOWUP',
  'CRON_AGENDADO',
  // Orquestração (Fase B):
  'LEAD_RESPONDEU',
  'LEAD_SEM_RESPOSTA',
  'IA_CLASSIFICOU',
  'LEAD_RECEBEU_TAG',
  // Orquestração (Fase C):
  'MENSAGEM_CANAL',
  'WEBHOOK_RECEBIDO',
] as const;
// ⚠️ MANTER SINCRONIZADO com o enum FluxoAcaoTipo do Prisma (schema.prisma).
export const fluxoAcaoTipoValues = [
  'ENVIAR_WHATSAPP',
  'ENVIAR_EMAIL',
  'CRIAR_TAREFA',
  'MUDAR_TAG',
  'MOVER_LEAD_ETAPA',
  'ATRIBUIR_REP',
  'WEBHOOK_EXTERNO',
  // Orquestração (Fase B):
  'CONVERSAR_IA',
  'LIBERAR_LOTE',
  'PAUSAR_IA',
] as const;

// ─── Nó (FluxoNo) ────────────────────────────────────────────────────
export const createFluxoNoSchema = z.object({
  // id fornecido pelo frontend (para poder referenciar em arestas)
  id: z.string().min(1),
  tipo: z.enum(fluxoNoTipoValues),
  // nullable: nós não-ACAO (TRIGGER/CONDICAO/DELAY) mandam acaoTipo null pelo editor.
  acaoTipo: z.enum(fluxoAcaoTipoValues).nullable().optional(),
  titulo: z.string().min(1).max(100),
  config: z.record(z.unknown()).default({}),
  posX: z.number().default(0),
  posY: z.number().default(0),
});

// ─── Aresta (FluxoEdge) ───────────────────────────────────────────────
export const createFluxoEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNoId: z.string().min(1),
  targetNoId: z.string().min(1),
  label: z.string().nullable().optional(),
});

// ─── Criar fluxo ─────────────────────────────────────────────────────
export const createFluxoSchema = z.object({
  nome: z.string().min(1).max(150),
  descricao: z.string().max(500).optional(),
  triggerTipo: z.enum(fluxoTriggerTipoValues).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  nos: z.array(createFluxoNoSchema).default([]),
  arestas: z.array(createFluxoEdgeSchema).default([]),
});

// ─── Import / Export de fluxo (arquivo .json) ────────────────────────
/**
 * Nó no arquivo de import: `id` é uma CHAVE estável (ex: "trigger", "msg1")
 * referenciada pelas arestas. No import o backend gera ids internos novos,
 * então o mesmo arquivo pode ser importado várias vezes sem colisão.
 */
const importFluxoNoSchema = z.object({
  id: z.string().min(1).max(120),
  tipo: z.enum(fluxoNoTipoValues),
  acaoTipo: z.enum(fluxoAcaoTipoValues).nullable().optional(),
  titulo: z.string().min(1).max(100),
  config: z.record(z.unknown()).optional().default({}),
  posX: z.number().optional().default(0),
  posY: z.number().optional().default(0),
});

/** Aresta no arquivo de import: referencia nós pela CHAVE (id acima); sem id próprio. */
const importFluxoEdgeSchema = z.object({
  sourceNoId: z.string().min(1),
  targetNoId: z.string().min(1),
  label: z.string().max(40).nullable().optional(),
});

export const importFluxoSchema = z
  .object({
    // Envelope opcional/tolerante — aceita arquivo "cru" sem ele.
    betinnaFluxo: z.literal(1).optional(),
    tipo: z.literal('fluxo').optional(),
    nome: z.string().min(1).max(150),
    descricao: z.string().max(500).nullable().optional(),
    triggerTipo: z.enum(fluxoTriggerTipoValues).nullable().optional(),
    triggerConfig: z.record(z.unknown()).nullable().optional(),
    nos: z.array(importFluxoNoSchema).max(200).default([]),
    arestas: z.array(importFluxoEdgeSchema).max(400).default([]),
  })
  .superRefine((d, ctx) => {
    const ids = new Set(d.nos.map((n) => n.id));
    if (ids.size !== d.nos.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Há nós com id (chave) duplicado',
        path: ['nos'],
      });
    }
    d.arestas.forEach((e, i) => {
      if (!ids.has(e.sourceNoId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Aresta ${i}: sourceNoId "${e.sourceNoId}" não existe em nos`,
          path: ['arestas', i, 'sourceNoId'],
        });
      }
      if (!ids.has(e.targetNoId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Aresta ${i}: targetNoId "${e.targetNoId}" não existe em nos`,
          path: ['arestas', i, 'targetNoId'],
        });
      }
    });
    d.nos.forEach((n, i) => {
      if (n.tipo === 'ACAO' && !n.acaoTipo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Nó "${n.id}" é ACAO mas não tem acaoTipo`,
          path: ['nos', i, 'acaoTipo'],
        });
      }
    });
  });

// ─── Atualizar fluxo ─────────────────────────────────────────────────
export const updateFluxoSchema = z.object({
  nome: z.string().min(1).max(150).optional(),
  descricao: z.string().max(500).optional(),
  triggerTipo: z.enum(fluxoTriggerTipoValues).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  /// Quando fornecidos, substituem TODOS os nós e arestas existentes (full replace).
  nos: z.array(createFluxoNoSchema).optional(),
  arestas: z.array(createFluxoEdgeSchema).optional(),
});

// ─── Listar fluxos ───────────────────────────────────────────────────
export const listFluxosSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(fluxoStatusValues).optional(),
  triggerTipo: z.enum(fluxoTriggerTipoValues).optional(),
  search: z.string().optional(),
});

// ─── Listar execuções ────────────────────────────────────────────────
export const listExecucoesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDENTE', 'EM_EXECUCAO', 'CONCLUIDO', 'FALHOU', 'CANCELADO']).optional(),
});

// ─── Testar fluxo (execução manual) ─────────────────────────────────
export const testarFluxoSchema = z.object({
  fluxoId: z.string().cuid(),
  /// Contexto inicial da execução de teste
  contexto: z.record(z.unknown()).default({}),
});

export const cronPreviewSchema = z
  .object({
    // `expressao` (singular) mantém back-compat; `expressoes` (plural) cobre
    // múltiplos horários/regras no mesmo gatilho.
    expressao: z.string().max(120).optional(),
    expressoes: z.array(z.string().max(120)).max(20).optional(),
    timezone: z.string().max(64).optional(),
    pularFeriados: z.boolean().optional(),
  })
  .refine(
    (d) => (d.expressoes && d.expressoes.length > 0) || (d.expressao && d.expressao.length > 0),
    { message: 'Informe `expressao` ou `expressoes`.' },
  );

// ─── Types ────────────────────────────────────────────────────────────
export type CronPreviewDto = z.infer<typeof cronPreviewSchema>;
export type CreateFluxoDto = z.infer<typeof createFluxoSchema>;
export type UpdateFluxoDto = z.infer<typeof updateFluxoSchema>;
export type ListFluxosDto = z.infer<typeof listFluxosSchema>;
export type ListExecucoesDto = z.infer<typeof listExecucoesSchema>;
export type TestarFluxoDto = z.infer<typeof testarFluxoSchema>;
export type CreateFluxoNoDto = z.infer<typeof createFluxoNoSchema>;
export type CreateFluxoEdgeDto = z.infer<typeof createFluxoEdgeSchema>;
export type ImportFluxoDto = z.infer<typeof importFluxoSchema>;
