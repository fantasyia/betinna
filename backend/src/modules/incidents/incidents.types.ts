import type {
  MarketplaceIncidentStatus,
  MarketplaceIncidentTipo,
  MessageChannel,
} from '@prisma/client';

/**
 * Payload canal-agnóstico que adapters de marketplace usam pra registrar
 * (upsert) um incidente vindo do mundo externo (webhook ou sync).
 */
export interface IncidenteEntranteParams {
  empresaId: string;
  canal: MessageChannel;
  /** ID externo do incidente (claim id ML, dispute id Shopee, etc.). */
  externalId: string;
  tipo: MarketplaceIncidentTipo;
  status: MarketplaceIncidentStatus;
  motivo?: string;
  motivoCodigo?: string;
  pedidoExternoId?: string;
  clienteId?: string;
  valor?: number;
  valorReembolso?: number;
  prazoResposta?: Date;
  resumo?: string;
  /** Quando o incidente tem chat (ex: ML claim messages) — id da conversation pra anexar. */
  conversationId?: string;
  metadata?: Record<string, unknown>;
}
