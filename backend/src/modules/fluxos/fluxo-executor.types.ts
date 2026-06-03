/** Nome da fila BullMQ de execução de fluxos. */
export const FLUXO_QUEUE = 'fluxo-execucao';

/** Payload do job BullMQ (um passo da execução). */
export interface FluxoStepJobData {
  execucaoId: string;
  noId: string;
}

/** Config do nó DELAY. */
export interface DelayConfig {
  valor: number;
  unidade: 'minutos' | 'horas' | 'dias';
}

/** Config do nó CONDICAO. */
export interface CondicaoConfig {
  campo: string; // ex: "lead.etapa", "pedido.total"
  operador: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
  valor: string | number;
}

/** Config da ação ENVIAR_WHATSAPP. */
export interface EnviarWhatsappConfig {
  mensagem: string; // suporta {{ variáveis }}
}

/** Config da ação ENVIAR_EMAIL. */
export interface EnviarEmailConfig {
  destinatario?: string; // padrão: e-mail do cliente
  assunto: string;
  corpo: string; // HTML ou texto
}

/** Config da ação CRIAR_TAREFA. */
export interface CriarTarefaConfig {
  titulo: string;
  tipo?: 'VISITA' | 'LIGACAO' | 'REUNIAO' | 'ENTREGA' | 'TAREFA';
  diasApartirDeHoje?: number;
}

/** Config da ação MUDAR_TAG. */
export interface MudarTagConfig {
  tagNome: string;
  operacao: 'adicionar' | 'remover';
}

/** Config da ação MOVER_LEAD_ETAPA. */
export interface MoverLeadEtapaConfig {
  etapa: 'NOVO' | 'QUALIFICANDO' | 'PROPOSTA' | 'NEGOCIACAO' | 'GANHO' | 'PERDIDO';
}

/** Config da ação ATRIBUIR_REP. */
export interface AtribuirRepConfig {
  representanteId: string;
}

/** Config da ação WEBHOOK_EXTERNO. */
export interface WebhookExternoConfig {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  payload?: Record<string, unknown>; // suporta {{ variáveis }}
}

/** Config da ação CONVERSAR_IA (orquestração Fase B). */
export interface ConversarIaConfig {
  /** Prompt da biblioteca (BotPrompt.id). Vazio = prompt padrão da empresa. */
  promptId?: string;
  /** Pausa o fluxo até o lead responder no WhatsApp. Default true. */
  aguardarResposta?: boolean;
  /** Timeout da espera (horas). Default 24. */
  timeoutHoras?: number;
  /** Variáveis que a IA pode gravar (referência; a IA grava o que devolver no JSON). */
  variaveisGravadas?: string[];
}

/** Config da ação LIBERAR_LOTE (orquestração Fase B). */
export interface LiberarLoteConfig {
  /** Etapa de origem (de onde tira os leads). */
  etapaOrigemId: string;
  /** Etapa de destino (pra onde move). */
  etapaDestinoId: string;
  /** Quantos leads liberar por execução. */
  quantidade: number;
  /** Funil (opcional — restringe a busca). */
  funilId?: string;
}

/** Contexto de execução — enriquecido progressivamente. */
export type ExecucaoContexto = Record<string, unknown>;
