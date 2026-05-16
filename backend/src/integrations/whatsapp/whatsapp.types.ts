/**
 * Status agregado de uma sessão Baileys vista do app.
 */
export type WhatsAppSessionStatus =
  | 'DISCONNECTED'   // sem sessão ativa
  | 'CONNECTING'     // socket abrindo, ainda sem QR/auth
  | 'QR_PENDING'     // aguardando escaneamento de QR code (primeiro pareamento)
  | 'CONNECTED'      // socket conectado e pareado
  | 'LOGGED_OUT'     // logout explícito (precisa reconectar e parear)
  | 'ERROR';         // erro persistente

/**
 * Owner type da sessão:
 *  - EMPRESA: WhatsApp central da empresa (1 número compartilhado pela equipe SAC)
 *  - USUARIO: WhatsApp pessoal de um usuário (cada rep tem o próprio)
 */
export type WhatsAppOwnerType = 'EMPRESA' | 'USUARIO';

export interface WhatsAppSessionInfo {
  ownerType: WhatsAppOwnerType;
  /** empresaId quando EMPRESA; usuarioId quando USUARIO. */
  ownerId: string;
  /** empresaId da sessão — sempre presente (USUARIO precisa de tenant também). */
  empresaId: string;
  status: WhatsAppSessionStatus;
  /** Apenas quando status=QR_PENDING. Data URL PNG pronta pra renderizar. */
  qrDataUrl?: string;
  /** Texto cru do QR (caso o cliente queira gerar a imagem). */
  qrRaw?: string;
  /** Número conectado (JID), quando CONNECTED. */
  numero?: string;
  /** Último erro (se ERROR). */
  erro?: string;
  /** Última transição. */
  desde?: Date;
}
