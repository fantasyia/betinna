import { z } from 'zod';

// ─── Enums sync com Prisma ────────────────────────────────────────────
export const fluxoStatusValues = ['RASCUNHO', 'ATIVO', 'PAUSADO', 'ARQUIVADO'] as const;
export const fluxoNoTipoValues = ['TRIGGER', 'CONDICAO', 'ACAO', 'DELAY'] as const;
export const fluxoTriggerTipoValues = [
  'LEAD_CRIADO',
  'LEAD_ETAPA_MUDOU',
  'PEDIDO_APROVADO',
  'PEDIDO_ENTREGUE',
  'OCORRENCIA_ABERTA',
  'CLIENTE_INATIVO_30D',
  'AMOSTRA_FOLLOWUP',
  'CRON_AGENDADO',
] as const;
export const fluxoAcaoTipoValues = [
  'ENVIAR_WHATSAPP',
  'ENVIAR_EMAIL',
  'CRIAR_TAREFA',
  'MUDAR_TAG',
  'MOVER_LEAD_ETAPA',
  'ATRIBUIR_REP',
  'WEBHOOK_EXTERNO',
] as const;

// ─── Nó (FluxoNo) ────────────────────────────────────────────────────
export const createFluxoNoSchema = z.object({
  // id fornecido pelo frontend (para poder referenciar em arestas)
  id: z.string().min(1),
  tipo: z.enum(fluxoNoTipoValues),
  acaoTipo: z.enum(fluxoAcaoTipoValues).optional(),
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

// ─── Types ────────────────────────────────────────────────────────────
export type CreateFluxoDto = z.infer<typeof createFluxoSchema>;
export type UpdateFluxoDto = z.infer<typeof updateFluxoSchema>;
export type ListFluxosDto = z.infer<typeof listFluxosSchema>;
export type ListExecucoesDto = z.infer<typeof listExecucoesSchema>;
export type TestarFluxoDto = z.infer<typeof testarFluxoSchema>;
export type CreateFluxoNoDto = z.infer<typeof createFluxoNoSchema>;
export type CreateFluxoEdgeDto = z.infer<typeof createFluxoEdgeSchema>;
