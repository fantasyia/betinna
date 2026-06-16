import type { Canal, ConversationStatus, ConversationCategoria } from './types';

/**
 * Sprint 2.3 — canais que NÃO aceitam resposta de texto livre.
 * Amazon e TikTok nunca; Shopee só em contexto de devolução/disputa.
 */
export function canalSemTextoLivre(
  canal: Canal,
  categoria?: ConversationCategoria | null,
): { bloqueado: boolean; motivo?: string } {
  if (canal === 'MARKETPLACE_AMAZON') {
    return {
      bloqueado: true,
      motivo: 'A Amazon não tem chat livre — a resposta ao comprador sai pelo Seller Central.',
    };
  }
  if (canal === 'MARKETPLACE_TIKTOK') {
    return {
      bloqueado: true,
      motivo: 'O TikTok Shop não expõe chat livre — responda pelo Seller Center.',
    };
  }
  if (canal === 'MARKETPLACE_SHOPEE' && (categoria === 'DEVOLUCAO' || categoria === 'DISPUTA')) {
    return {
      bloqueado: true,
      motivo: 'Em devolução/disputa a Shopee não aceita texto livre — use as ações da devolução.',
    };
  }
  return { bloqueado: false };
}

export const CANAL_LABEL: Record<Canal, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  EMAIL: 'E-mail',
  MARKETPLACE_ML: 'Mercado Livre',
  MARKETPLACE_SHOPEE: 'Shopee',
  MARKETPLACE_AMAZON: 'Amazon',
  MARKETPLACE_TIKTOK: 'TikTok Shop',
};

export const STATUS_LABEL: Record<ConversationStatus, string> = {
  ABERTA: 'Aberta',
  PENDENTE: 'Pendente',
  RESOLVIDA: 'Resolvida',
  ARQUIVADA: 'Arquivada',
};

export const STATUS_VARIANT: Record<ConversationStatus, 'info' | 'warning' | 'success' | 'neutral'> =
  {
    ABERTA: 'info',
    PENDENTE: 'warning',
    RESOLVIDA: 'success',
    ARQUIVADA: 'neutral',
  };

// Polling silencioso a cada 2s — mensagens novas aparecem mais rápido (o
// gargalo de segundos era o fetch de avatar no backend, agora assíncrono).
// WebSocket/SSE seria o ideal pra real-time instantâneo — fica como próximo
// passo se 2s ainda parecer lento.
export const POLL_INTERVAL_MS = 2_000;

// Emojis do picker do composer (qualquer canal).
export const EMOJIS = [
  '😀','😁','😂','🤣','😊','😍','😘','😎','🤔','😅','😢','😭','😡','🥳','😉','😴',
  '👍','👎','🙏','👏','🙌','💪','👋','🔥','🎉','❤️','✅','❌','⚠️','💯','🚀','🤝',
];
