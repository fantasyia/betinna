import type { Node } from '@xyflow/react';

/**
 * Tipos do editor de fluxos — espelham o schema do backend.
 *
 * Persistência: PUT /fluxos/:id com `{ nos, arestas, triggerTipo }`.
 * Backend faz full-replace dos nós e arestas (per schema docs).
 */

// ─── Tipos espelhando o schema do backend ─────────────────────────

export type FluxoNoTipo = 'TRIGGER' | 'CONDICAO' | 'ACAO' | 'DELAY';

export type TriggerTipo =
  | 'LEAD_CRIADO'
  | 'LEAD_ETAPA_MUDOU'
  | 'PEDIDO_APROVADO'
  | 'PEDIDO_ENTREGUE'
  | 'PEDIDO_RASTREIO_DISPONIVEL'
  | 'LEAD_REENGAJOU_SITE'
  | 'OCORRENCIA_ABERTA'
  | 'CLIENTE_INATIVO_30D'
  | 'AMOSTRA_FOLLOWUP'
  | 'CRON_AGENDADO'
  | 'LEAD_RESPONDEU'
  | 'LEAD_SEM_RESPOSTA'
  | 'IA_CLASSIFICOU'
  | 'LEAD_RECEBEU_TAG'
  | 'MENSAGEM_CANAL'
  | 'WEBHOOK_RECEBIDO';

export type AcaoTipo =
  | 'ENVIAR_WHATSAPP'
  | 'ENVIAR_EMAIL'
  | 'CRIAR_TAREFA'
  | 'MUDAR_TAG'
  | 'MOVER_LEAD_ETAPA'
  | 'ATRIBUIR_REP'
  | 'WEBHOOK_EXTERNO'
  | 'CONVERSAR_IA'
  | 'LIBERAR_LOTE'
  | 'PAUSAR_IA'
  | 'CRIAR_LEAD'
  | 'TRANSFERIR_ATENDIMENTO';

export interface FluxoNoApi {
  id?: string;
  tipo: FluxoNoTipo;
  acaoTipo?: string | null;
  titulo: string;
  config?: Record<string, unknown>;
  posX?: number;
  posY?: number;
}

export interface FluxoEdgeApi {
  id?: string;
  sourceNoId: string;
  targetNoId: string;
  label?: string | null;
}

export interface FluxoDetailApi {
  id: string;
  nome: string;
  descricao?: string | null;
  status: 'RASCUNHO' | 'ATIVO' | 'PAUSADO' | 'ARQUIVADO';
  triggerTipo?: TriggerTipo | null;
  /// Agendamento do CRON (o job lê daqui). Fluxo criado por MCP/import guarda o
  /// horário SÓ aqui — a hidratação espelha no nó TRIGGER pro editor mostrar.
  triggerConfig?: Record<string, unknown> | null;
  nos?: FluxoNoApi[];
  arestas?: FluxoEdgeApi[];
}

// ─── Palette items (categorias do print) ────────────────────────

export interface PaletteItem {
  id: string;
  label: string;
  tipo: FluxoNoTipo;
  acaoTipo?: AcaoTipo;
  triggerTipo?: TriggerTipo;
  /** Gatilho "Manual" (sem trigger automático) — nó TRIGGER sem triggerTipo. */
  manual?: boolean;
  /**
   * Config inicial do nó criado por este item.
   *
   * Existe pra o mesmo `acaoTipo` poder aparecer na paleta como DOIS blocos com
   * comportamentos opostos — é o caso de PAUSAR_IA, que com `religar: true` faz
   * o contrário do nome do tipo.
   */
  config?: Record<string, unknown>;
}

// ─── Node data interno ────────────────────────────────────────────

export interface NodePayload extends Record<string, unknown> {
  titulo: string;
  tipo: FluxoNoTipo;
  acaoTipo?: AcaoTipo;
  triggerTipo?: TriggerTipo;
  config: Record<string, unknown>;
}

export type FlowNode = Node<NodePayload>;
