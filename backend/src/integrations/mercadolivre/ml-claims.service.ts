import { Injectable, Logger } from '@nestjs/common';
import type {
  MarketplaceIncidentStatus,
  MarketplaceIncidentTipo,
} from '@prisma/client';
import { IncidentsService } from '@modules/incidents/incidents.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { MLClientService } from './ml-client.service';
import type { MLClaim, MLClaimMessage, MLClaimsSearchResponse } from './ml.types';

/**
 * Reclamações pós-compra do Mercado Livre.
 *
 * Cobre:
 *  - Claims (reclamação simples — comprador abre solicitação)
 *  - Mediações (escala → ML intermedia)
 *  - Returns (devolução de produto)
 *  - Cancel purchases (cancelamentos disputados)
 *
 * Cada claim vira:
 *  - `MarketplaceIncident` no banco (com status mapeado pro enum genérico)
 *  - `Conversation` (categoria=RECLAMACAO/MEDIACAO/DEVOLUCAO conforme tipo)
 *    com as mensagens dentro do claim
 *
 * Vínculo entre os dois: `Conversation.incidentId` aponta pro incident.
 */
@Injectable()
export class MLClaimsService {
  private readonly logger = new Logger(MLClaimsService.name);

  constructor(
    private readonly ml: MLClientService,
    private readonly inbox: InboxService,
    private readonly incidents: IncidentsService,
  ) {}

  async obter(empresaId: string, claimId: string | number): Promise<MLClaim> {
    return this.ml.get<MLClaim>(empresaId, `/post-purchase/v1/claims/${claimId}`);
  }

  async listarAbertas(empresaId: string, limit = 50): Promise<MLClaim[]> {
    const params = new URLSearchParams({
      status: 'opened',
      limit: String(limit),
    });
    const r = await this.ml.get<MLClaimsSearchResponse>(
      empresaId,
      `/post-purchase/v1/claims/search?${params}`,
    );
    return r.data ?? [];
  }

  async listarMensagens(
    empresaId: string,
    claimId: string | number,
  ): Promise<MLClaimMessage[]> {
    const r = await this.ml.get<{ messages: MLClaimMessage[] }>(
      empresaId,
      `/post-purchase/v1/claims/${claimId}/messages`,
    );
    return r.messages ?? [];
  }

  /**
   * Processa uma claim: registra/atualiza o incident, garante a conversation
   * vinculada e importa mensagens recentes.
   */
  async processarClaim(empresaId: string, claim: MLClaim): Promise<void> {
    const tipo = this.mapTipo(claim);
    const status = this.mapStatus(claim);
    const categoria = this.categoriaPraTipo(tipo);
    const peerId = `claim:${claim.id}`;

    // 1. Cria/atualiza Conversation com a categoria certa
    // Usamos uma mensagem "sistêmica" com o resumo da claim — força o upsert.
    const resumo = this.resumoDaClaim(claim);
    const eventoEntrante = await this.inbox.processarMensagemEntrante({
      empresaId,
      canal: 'MARKETPLACE_ML',
      peerId,
      peerNome: this.peerNomeDaClaim(claim),
      tipo: 'SYSTEM',
      conteudo: resumo,
      externalId: `claim:${claim.id}:event:${claim.last_updated}`,
      data: new Date(claim.last_updated),
      meta: {
        ml_claim_id: claim.id,
        ml_claim_type: claim.type,
        ml_claim_stage: claim.stage,
        ml_claim_status: claim.status,
        ml_resource: claim.resource,
        ml_resource_id: claim.resource_id,
        categoria,
      },
    });

    // 2. Registra o incident — vincula à conversation recém-criada/atualizada
    await this.incidents.registrarIncidente({
      empresaId,
      canal: 'MARKETPLACE_ML',
      externalId: String(claim.id),
      tipo,
      status,
      motivo: claim.status_detail ?? undefined,
      motivoCodigo: claim.reason_id ?? undefined,
      pedidoExternoId: claim.resource === 'order' ? String(claim.resource_id) : undefined,
      prazoResposta: claim.expiration_date ? new Date(claim.expiration_date) : undefined,
      resumo,
      conversationId: eventoEntrante.conversationId,
      metadata: {
        ml_claim: claim,
      },
    });

    // 3. Importa mensagens da claim (chat interno)
    try {
      const msgs = await this.listarMensagens(empresaId, claim.id);
      for (const m of msgs) {
        // sender_role tipicamente 'complainant' (comprador) | 'respondent' (vendedor) | 'mediator'
        const fromMe = m.sender_role === 'respondent';
        if (fromMe) continue;
        await this.inbox.processarMensagemEntrante({
          empresaId,
          canal: 'MARKETPLACE_ML',
          peerId,
          peerNome: this.peerNomeDaClaim(claim),
          tipo: m.attachments?.length ? 'DOCUMENT' : 'TEXT',
          conteudo: m.message,
          externalId: `claim:${claim.id}:msg:${m.date_created}`,
          data: new Date(m.date_created),
          meta: {
            ml_claim_id: claim.id,
            ml_sender_role: m.sender_role,
            categoria,
          },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Falha importando mensagens da claim ${claim.id} (empresa=${empresaId}): ${msg}`,
      );
    }
  }

  /** Envia mensagem no chat da reclamação. */
  async enviarMensagem(
    empresaId: string,
    claimId: string | number,
    texto: string,
  ): Promise<{ externalId?: string }> {
    const r = await this.ml.post<{ id?: string }>(
      empresaId,
      `/post-purchase/v1/claims/${claimId}/messages`,
      { message: texto, type: 'text' },
    );
    return { externalId: r.id ? String(r.id) : undefined };
  }

  // ─── Mapeamento de status/tipo ────────────────────────────────────────

  private mapTipo(claim: MLClaim): MarketplaceIncidentTipo {
    if (claim.stage === 'dispute' || claim.stage === 'mediations') return 'MEDIACAO';
    if (claim.type === 'return' || claim.type === 'change') return 'DEVOLUCAO';
    if (claim.type === 'cancel_purchase') return 'CANCELAMENTO';
    return 'RECLAMACAO';
  }

  private mapStatus(claim: MLClaim): MarketplaceIncidentStatus {
    switch (claim.status) {
      case 'opened':
        return 'AGUARDANDO_VENDEDOR';
      case 'closed':
      case 'closed_with_refund':
      case 'closed_with_response':
        return 'RESOLVIDO';
      case 'expired':
        return 'EXPIRADO';
      case 'cancelled':
        return 'CANCELADO';
      default:
        // Stages intermediários: dispute/mediations
        if (claim.stage === 'dispute' || claim.stage === 'mediations') return 'EM_MEDIACAO';
        return 'ABERTO';
    }
  }

  private categoriaPraTipo(
    tipo: MarketplaceIncidentTipo,
  ): 'RECLAMACAO' | 'MEDIACAO' | 'DEVOLUCAO' | 'DISPUTA' {
    if (tipo === 'MEDIACAO') return 'MEDIACAO';
    if (tipo === 'DEVOLUCAO') return 'DEVOLUCAO';
    if (tipo === 'DISPUTA') return 'DISPUTA';
    return 'RECLAMACAO';
  }

  private resumoDaClaim(c: MLClaim): string {
    const partes = [
      `Reclamação ${c.id}`,
      c.type ? `tipo=${c.type}` : null,
      c.stage ? `stage=${c.stage}` : null,
      c.status ? `status=${c.status}` : null,
      c.status_detail,
    ].filter(Boolean);
    return partes.join(' · ').slice(0, 280);
  }

  private peerNomeDaClaim(c: MLClaim): string {
    return `Reclamação ML #${c.id}`;
  }
}
