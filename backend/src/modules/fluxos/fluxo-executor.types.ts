/** Nome da fila BullMQ de execução de fluxos. */
export const FLUXO_QUEUE = 'fluxo-execucao';

/** Payload do job BullMQ (um passo da execução). */
export interface FluxoStepJobData {
  execucaoId: string;
  noId: string;
}

/** Unidade de tempo (DELAY, espera de encerramento do nó de IA, etc.). */
export type UnidadeTempo = 'segundos' | 'minutos' | 'horas' | 'dias';

/** Converte {valor, unidade} em milissegundos (fonte única — DELAY e encerramento IA). */
export function unidadeTempoMs(valor: number, unidade: UnidadeTempo): number {
  const mult: Record<UnidadeTempo, number> = {
    segundos: 1_000,
    minutos: 60_000,
    horas: 3_600_000,
    dias: 86_400_000,
  };
  return Math.max(0, valor) * (mult[unidade] ?? 60_000);
}

/** Config do nó DELAY. O front grava `quantidade`; `valor` é compat legada (lida, não escrita). */
export interface DelayConfig {
  quantidade?: number;
  /** @deprecated chave antiga — o front sempre grava `quantidade`. Mantida só por compat de leitura. */
  valor?: number;
  unidade?: UnidadeTempo;
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
  mensagem: string; // suporta {{ variáveis }}. Com `midia`, vira a LEGENDA.
  /** Destinatário: 'lead' (lead/cliente da conversa — default), 'numero' (livre), 'contato' (inbox). */
  destinatarioModo?: 'lead' | 'numero' | 'contato';
  /** Modo 'numero': telefone livre com DDI (ex: +55 11 9...). */
  destinatarioNumero?: string;
  /** Modo 'contato': telefone do contato escolhido no dropdown da inbox. */
  destinatarioContato?: string;
  /**
   * Anexo OPCIONAL (subido pro Storage no editor → guarda só o storagePath, não base64). Quando
   * presente, envia mídia em vez de texto e a `mensagem` (interpolada) vira a legenda.
   */
  midia?: {
    tipo: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
    storagePath: string;
    mimetype?: string;
    fileName?: string;
    /** AUDIO gravado na hora = true (PTT/bolha de voz); áudio anexado = false (áudio normal). */
    ptt?: boolean;
  };
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
  /** Nome do header de idempotência (default X-Idempotency-Key; Stripe-style usa Idempotency-Key). */
  idempotencyHeader?: string;
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
  /** RAG — consulta o catálogo de produtos (busca semântica) e injeta no prompt. Default false. */
  consultarCatalogo?: boolean;
  /** RAG — consulta a base de conhecimento da empresa (FAQ/condições) e injeta. Default false. */
  consultarConhecimento?: boolean;
  /**
   * ENCERRAMENTO EDUCADO: depois que a IA classifica, em vez de encerrar a conversa
   * na hora, mantém o nó de IA respondendo o rep por esse tempo (a tag/aviso disparam
   * já, em paralelo). Ausente ou valor 0 = encerra na hora (comportamento antigo).
   */
  encerramentoEspera?: { valor: number; unidade: UnidadeTempo };
}

/** Config da ação LIBERAR_LOTE (orquestração Fase B). */
export interface LiberarLoteConfig {
  /** Etapa de origem (de onde tira os leads). */
  etapaOrigemId: string;
  /** Etapa de destino (pra onde move). */
  etapaDestinoId: string;
  /** Quantos leads liberar por execução. */
  quantidade: number;
  /**
   * Capacidade: trata `quantidade` como o MÁXIMO de leads na etapa de DESTINO,
   * não só o lote por execução. Liga essa validação → o nó conta quantos leads
   * já estão no destino e só libera o que falta pra chegar em `quantidade`; se já
   * está cheio, libera 0 (espera um lead SAIR do destino). Ex: quantidade=1 →
   * mantém no máximo 1 lead na abordagem por vez. Default false (lote por execução).
   */
  respeitarCapacidadeDestino?: boolean;
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
  /**
   * Só libera leads que TÊM telefone de WhatsApp (≥8 dígitos). Use quando a
   * etapa destino dispara abordagem por IA/WhatsApp — evita "queimar" leads sem
   * número na etapa de abordagem. Default false (libera todos).
   */
  filtroSoComWhatsapp?: boolean;
}

/** Contexto de execução — enriquecido progressivamente. */
export type ExecucaoContexto = Record<string, unknown>;
