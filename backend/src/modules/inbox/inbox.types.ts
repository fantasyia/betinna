import type { MessageChannel, MessageType } from '@prisma/client';

/**
 * Contexto opcional da Conversation passado pro adapter. Útil pra canais com
 * múltiplas sessões/donos por empresa (ex: WhatsApp empresa vs WhatsApp do rep).
 */
export interface CanalAdapterContexto {
  /** `Conversation.proprietarioId` — quando preenchido, indica a sessão dona da conversa. */
  proprietarioId?: string | null;
  /** `Conversation.metadata` — info canal-específica armazenada na conversa. */
  metadata?: Record<string, unknown> | null;
  /** Quote/citação: externalId (key.id do WhatsApp) da msg citada + se é nossa. */
  quoted?: { externalId: string; fromMe: boolean; participant?: string } | null;
}

/**
 * Interface que todo adapter de canal (WhatsApp, IG, FB, ...) precisa implementar.
 * Os módulos de integração registram seu adapter no `CanalAdapterRegistry` no boot.
 */
export interface CanalAdapter {
  readonly canal: MessageChannel;

  /**
   * Envia mensagem de texto. Retorna o id externo se disponível (idempotência).
   * `ctx` traz info da Conversation pra adapters que precisam (WhatsApp usa
   * `proprietarioId` pra escolher sessão; outros podem ignorar).
   */
  enviarTexto(
    empresaId: string,
    peerId: string,
    texto: string,
    ctx?: CanalAdapterContexto,
  ): Promise<{ externalId?: string }>;

  /**
   * Indica se o adapter está pronto pra enviar mensagens da empresa.
   * Pra WhatsApp: socket conectado + sessão pareada.
   * `proprietarioId` quando informado checa sessão específica.
   */
  estaDisponivel(empresaId: string, proprietarioId?: string | null): Promise<boolean>;

  /**
   * Reage a uma mensagem com um emoji (opcional — só canais que suportam, ex:
   * WhatsApp). `emoji` vazio remove a reação. `fromMe` = a msg reagida é OUTBOUND.
   */
  reagir?(
    empresaId: string,
    peerId: string,
    messageId: string,
    fromMe: boolean,
    emoji: string,
    ctx?: CanalAdapterContexto,
  ): Promise<void>;
}

/**
 * Payload entregue pelo adapter ao InboxService quando uma mensagem chega
 * do mundo externo. O service materializa Conversation + Message + resolve Cliente.
 */
export interface MensagemEntranteParams {
  empresaId: string;
  canal: MessageChannel;
  peerId: string;
  peerNome?: string;
  /** Match opcional por telefone normalizado (E.164 sem +). Quando informado, tenta vincular ao Cliente. */
  peerTelefone?: string;
  /** Match opcional por e-mail. */
  peerEmail?: string;
  tipo: MessageType;
  conteudo: string;
  externalId?: string;
  /**
   * Direção da mensagem. Default INBOUND (recebida do peer).
   * OUTBOUND quando o próprio número enviou (ex: dono respondeu pelo celular
   * enquanto Baileys está pareado — `m.key.fromMe = true`).
   * Idempotência por externalId garante que mensagens enviadas pela Betinna
   * não sejam duplicadas quando o evento volta pelo socket.
   */
  direction?: 'INBOUND' | 'OUTBOUND';
  /**
   * Pra mensagens em GRUPO: nome do membro que mandou a mensagem (pushName).
   * Frontend renderiza acima da bolha INBOUND ("João: oi pessoal").
   * Em 1:1 fica undefined — quem mandou é o próprio peer já mostrado no header.
   */
  senderName?: string;
  /** Data original da mensagem (default: agora). */
  data?: Date;
  mediaUrl?: string;
  mediaMime?: string;
  /**
   * Quando a sessão é pessoal (WhatsApp do rep), id do `Usuario` dono da sessão.
   * Empresa-level (WhatsApp central, IG/FB/marketplaces) deixa undefined.
   * Permite múltiplas conversas com o mesmo peer em sessões distintas.
   */
  proprietarioId?: string;
  meta?: Record<string, unknown>;
}
