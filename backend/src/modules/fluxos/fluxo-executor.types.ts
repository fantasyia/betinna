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

/** Config do nó CONDICAO (modo simples true/false OU roteador multi-saída). */
export interface CondicaoConfig {
  /** 'simples' = true/false (default) · 'roteador' = N saídas por valor + default. */
  modo?: 'simples' | 'roteador';
  // ── modo simples ──
  campo?: string; // ex: "lead.etapa", "classificacao_final"
  operador?: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
  valor?: string | number;
  // ── modo roteador ──
  /** Variável a rotear (ex: "classificacao_final"). Lida do contexto. */
  variavel?: string;
  /** Valores possíveis: cada um vira uma saída (label). + saída "default". */
  saidas?: string[];
}

/** Config da ação ENVIAR_WHATSAPP. */
export interface EnviarWhatsappConfig {
  mensagem: string; // suporta {{ variáveis }}
  /** Destinatário: 'lead' (lead/cliente da conversa — default), 'numero' (livre), 'contato' (inbox). */
  destinatarioModo?: 'lead' | 'numero' | 'contato';
  /** Modo 'numero': telefone livre com DDI (ex: +55 11 9...). */
  destinatarioNumero?: string;
  /** Modo 'contato': telefone do contato escolhido no dropdown da inbox. */
  destinatarioContato?: string;
}

/** Config da ação ENVIAR_EMAIL. */
export interface EnviarEmailConfig {
  destinatario?: string; // legado (1 destinatário). Padrão: e-mail do cliente.
  /** Destinatários: e-mail cru, "user:<id>", "papel:<ROLE>" ou {{variável}}. */
  destinatarios?: string[];
  assunto: string;
  corpo: string; // HTML ou texto
}

/** Config da ação CRIAR_TAREFA. */
export interface CriarTarefaConfig {
  titulo: string;
  descricao?: string;
  /** Usuário responsável (id). Vazio = rep do cliente / fallback ADMIN/DIRECTOR. */
  responsavelId?: string;
  tipo?: 'VISITA' | 'LIGACAO' | 'REUNIAO' | 'ENTREGA' | 'TAREFA';
  diasApartirDeHoje?: number; // prazo (em X dias a partir de hoje)
}

/** Config da ação MUDAR_TAG. */
export interface MudarTagConfig {
  tagNome: string;
  operacao: 'adicionar' | 'remover';
}

/** Config da ação MOVER_LEAD_ETAPA. */
export interface MoverLeadEtapaConfig {
  /** Etapa do FUNIL customizado (id da FunilEtapa) — preferencial (dropdown). */
  funilEtapaId?: string;
  /** Enum legado (fallback quando não há funilEtapaId). */
  etapa?: 'NOVO' | 'QUALIFICANDO' | 'PROPOSTA' | 'NEGOCIACAO' | 'GANHO' | 'PERDIDO';
}

/** Config da ação PAUSAR_IA — desliga (ou religa) o bot na conversa do lead. */
export interface PausarIaConfig {
  /** true = religa (botLigado=true); default/false = pausa (botLigado=false). */
  religar?: boolean;
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
  /**
   * Ordem de liberação: 'antigos' (criadoEm asc), 'novos' (criadoEm desc) ou
   * 'custom' (ordena por uma chave de Lead.variaveis). Ausente = legado
   * (ordemPrioridade asc, depois criadoEm asc).
   */
  criterioOrdem?: 'antigos' | 'novos' | 'custom';
  /** Modo 'custom': chave em Lead.variaveis pra ordenar (ex: prioridade_leo). */
  campoOrdem?: string;
  /** Direção do 'custom' (default asc). */
  ordemDir?: 'asc' | 'desc';
  /** Nomes de tags — leads com QUALQUER uma são EXCLUÍDOS do lote (ex: 'pausado'). */
  filtroExcluiTag?: string[];
}

/** Contexto de execução — enriquecido progressivamente. */
export type ExecucaoContexto = Record<string, unknown>;
