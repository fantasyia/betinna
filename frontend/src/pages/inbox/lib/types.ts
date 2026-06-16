// Tipos do Inbox (extraídos de InboxPage.tsx no refactor de 2026-06-16).
// Espelham o schema do backend (Prisma) — ATENÇÃO aos nomes de campo:
// peerId/conteudo/ultimaMsgEm/meta.* são contrato vivo (renomeações já causaram
// bugs de "tela em branco"). Não renomear sem alinhar com o backend.

export type Canal =
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'EMAIL'
  | 'MARKETPLACE_ML'
  | 'MARKETPLACE_SHOPEE'
  | 'MARKETPLACE_AMAZON'
  | 'MARKETPLACE_TIKTOK';

export type ConversationStatus = 'ABERTA' | 'PENDENTE' | 'RESOLVIDA' | 'ARQUIVADA';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'OTHER';

export type ConversationCategoria =
  | 'GERAL'
  | 'PRE_VENDA'
  | 'POS_VENDA'
  | 'RECLAMACAO'
  | 'MEDIACAO'
  | 'DEVOLUCAO'
  | 'DISPUTA';

export interface RespostaRapida {
  id: string;
  titulo: string;
  atalho: string;
  conteudo: string;
  global: boolean;
}

/**
 * Item #25 — nota interna de uma conversa (anotação da equipe; o cliente NÃO
 * vê). Backend devolve as mais recentes primeiro. Só o autor (ou ADMIN) pode
 * editar/excluir a própria — fora isso volta 403.
 */
export interface NotaInterna {
  id: string;
  conversationId: string;
  usuarioId: string;
  texto: string;
  criadoEm: string;
  atualizadoEm: string;
  usuario?: { id: string; nome: string } | null;
}

export interface Conversation {
  id: string;
  canal: Canal;
  categoria?: ConversationCategoria | null;
  status: ConversationStatus;
  // O backend (Prisma) serializa como `peerId` — identificador externo do
  // contato no canal (telefone no WhatsApp). `peer` fica como fallback legado.
  peerId: string;
  peer?: string;
  peerNome?: string | null;
  // Backend usa estes nomes (Prisma schema). Antes o frontend tinha
  // `ultimaMensagem`/`ultimaMensagemEm` errado → tela mostrava sempre
  // "sem mensagens" porque os campos vinham undefined. Fix 2026-05-27.
  ultimaMsgPreview?: string | null;
  ultimaMsgEm?: string | null;
  naoLidas?: number;
  cliente?: { id: string; nome: string } | null;
  atribuido?: { id: string; nome: string } | null;
  // Fase 2 — estado do bot Muller nesta conversa
  botPausadoAte?: string | null;
  precisaHumano?: boolean;
  // Override do bot por conversa: null = segue o global da empresa;
  // true = ligado aqui mesmo com o global off; false = desligado só aqui.
  botLigado?: boolean | null;
  // #25 fatia 2 — quando o cliente mandou a última msg SEM resposta (conversa
  // aberta). `null` = nada pendente (última foi nossa, ou já resolvida).
  aguardandoDesde?: string | null;
  // Item #25 — etiquetas livres de triagem (só a equipe vê). Backend retorna
  // sempre como array (default []).
  tagsInternas?: string[];
  /**
   * JSON com metadados canal-específicos:
   *  - telefone: telefone REAL do contato (resolvido no backend quando o peerId
   *    é um LID/número oculto). Quando presente, é a fonte preferida do número.
   */
  metadata?: { telefone?: string | null } & Record<string, unknown>;
}

export interface Mensagem {
  id: string;
  // Backend usa `conteudo` (Prisma schema). Antes o frontend tinha
  // `texto` errado → bolha aparecia em branco. Fix 2026-05-27.
  conteudo?: string | null;
  direction: MessageDirection;
  tipo: MessageType;
  criadoEm: string;
  autor?: { id: string; nome: string } | null;
  /** Fase 2 — true quando a mensagem foi gerada pelo bot Muller (tag 🤖). */
  enviadaPorBot?: boolean;
  /**
   * Meta JSON da mensagem. Hoje pode conter:
   * - senderName (pushName do membro que mandou — grupos)
   * - jid, ownerKey (debug WhatsApp)
   */
  meta?: { senderName?: string | null } & Record<string, unknown>;
  mediaUrl?: string | null;
  mediaMime?: string | null;
}

export interface UsuarioMinimo {
  id: string;
  nome: string;
  role: string;
}

/**
 * #25 fatia 3 — métricas gerenciais do SAC (`GET /inbox/metricas`).
 * Endpoint restrito a ADMIN/DIRECTOR/GERENTE/SAC — REP recebe 403, então
 * nem buscamos nem renderizamos o painel pra esse papel.
 */
export interface Metricas {
  conversas: {
    abertas: number;
    pendentes: number;
    resolvidas: number;
    arquivadas: number;
    total: number;
  };
  aguardando: {
    total: number;
    dentroDoPrazo: number;
    estourado: number;
    slaMinutos: number;
  };
  tempoMedioPrimeiraRespostaSegundos: number | null;
  porAtendente: Array<{
    atendenteId: string | null;
    atendenteNome: string;
    abertas: number;
    aguardando: number;
  }>;
}
