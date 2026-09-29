import { Injectable, Logger } from '@nestjs/common';
import type { MarketplaceIncidentStatus, MarketplaceIncidentTipo } from '@prisma/client';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { IncidentsService } from '@modules/incidents/incidents.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { MLClientService } from './ml-client.service';
import type { MLClaim, MLClaimMessage, MLClaimsSearchResponse } from './ml.types';

/**
 * O que a busca de claims NÃO traz e o vendedor precisa pra tratar pelo app
 * (Léo, 29/09: a mediação aparecia só com o id). Cada peça vem de um endpoint
 * próprio do ML; guardado em `metadata.ml_detalhe` do incidente.
 */
export interface DetalheClaimML {
  titulo: string | null;
  descricao: string | null;
  problema: string | null;
  /** De quem o ML espera a próxima ação: complainant | respondent | mediator. */
  responsavel: string | null;
  /** Prazo da próxima ação (de quem for o `responsavel`). */
  prazo: string | null;
  motivo: string | null;
  afetaReputacao: string | null;
  /** Ações que o ML libera pro vendedor agora (ex.: send_message_to_mediator). */
  acoesVendedor: string[];
  pedido: {
    id: string;
    total: number | null;
    itemId: string | null;
    titulo: string | null;
    variacao: string | null;
    sku: string | null;
    quantidade: number | null;
  } | null;
}

type Jogador = { role: string; available_actions?: Array<{ action?: string } | string> };

/** Nomes das ações disponíveis do vendedor (o ML manda objeto `{action}` ou string). */
export function acoesDoVendedor(players: Jogador[] | undefined): string[] {
  const v = (players ?? []).find((p) => p.role === 'respondent');
  return (v?.available_actions ?? [])
    .map((a) => (typeof a === 'string' ? a : a?.action))
    .filter((a): a is string => Boolean(a));
}

/**
 * Pra quem vai a mensagem do vendedor. O ML só aceita o destinatário que ele
 * libera em `available_actions`; sem nenhuma liberada, não há como mandar.
 */
export function destinatarioMensagem(acoes: string[]): 'complainant' | 'mediator' | null {
  if (acoes.includes('send_message_to_mediator')) return 'mediator';
  if (acoes.includes('send_message_to_complainant')) return 'complainant';
  return null;
}

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

  async listarMensagens(empresaId: string, claimId: string | number): Promise<MLClaimMessage[]> {
    // O v1 devolve um ARRAY na raiz (conferido na claim 5583814163, 29/09); o
    // `.messages` que se lia antes nunca existia e a mensagem do mediador não
    // entrava. Aceita os dois formatos.
    const r = await this.ml.get<MLClaimMessage[] | { messages?: MLClaimMessage[] }>(
      empresaId,
      `/post-purchase/v1/claims/${claimId}/messages`,
    );
    if (Array.isArray(r)) return r;
    return r?.messages ?? [];
  }

  /**
   * Junta o que o vendedor precisa pra decidir: o que o ML diz da situação
   * (título, descrição, de quem é a vez e o prazo), o motivo em texto, se
   * afeta a reputação e o produto do pedido. Cada pedaço falha sozinho —
   * detalhe faltando não impede o incidente de entrar.
   */
  async detalhar(empresaId: string, claim: MLClaim): Promise<DetalheClaimML> {
    const tentar = async <T>(path: string): Promise<T | null> => {
      try {
        return await this.ml.get<T>(empresaId, path);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Claim ${claim.id}: ${path} indisponível — ${m}`);
        return null;
      }
    };
    const [det, motivo, rep, pedido] = await Promise.all([
      tentar<{
        title?: string;
        description?: string;
        problem?: string;
        action_responsible?: string;
        due_date?: string | null;
      }>(`/post-purchase/v1/claims/${claim.id}/detail`),
      claim.reason_id
        ? tentar<{ detail?: string }>(`/post-purchase/v1/claims/reasons/${claim.reason_id}`)
        : Promise.resolve(null),
      tentar<{ affects_reputation?: string }>(
        `/post-purchase/v1/claims/${claim.id}/affects-reputation`,
      ),
      claim.resource === 'order'
        ? tentar<{
            id: number;
            total_amount?: number;
            order_items?: Array<{
              item?: {
                id?: string;
                title?: string;
                seller_sku?: string | null;
                variation_attributes?: Array<{ name?: string; value_name?: string }>;
              };
              quantity?: number;
            }>;
          }>(`/orders/${claim.resource_id}`)
        : Promise.resolve(null),
    ]);
    const item = pedido?.order_items?.[0];
    const variacao = (item?.item?.variation_attributes ?? [])
      .map((a) => [a.name, a.value_name].filter(Boolean).join(': '))
      .filter(Boolean)
      .join(' · ');
    return {
      titulo: det?.title ?? null,
      descricao: det?.description ?? null,
      problema: det?.problem ?? null,
      responsavel: det?.action_responsible ?? null,
      prazo: det?.due_date ?? null,
      motivo: motivo?.detail ?? null,
      afetaReputacao: rep?.affects_reputation ?? null,
      acoesVendedor: acoesDoVendedor(claim.players as Jogador[] | undefined),
      pedido: pedido?.id
        ? {
            id: String(pedido.id),
            total: typeof pedido.total_amount === 'number' ? pedido.total_amount : null,
            itemId: item?.item?.id ?? null,
            titulo: item?.item?.title ?? null,
            variacao: variacao || null,
            sku: item?.item?.seller_sku ?? null,
            quantidade: item?.quantity ?? null,
          }
        : null,
    };
  }

  /**
   * Processa uma claim: registra/atualiza o incident, garante a conversation
   * vinculada e importa mensagens recentes.
   */
  async processarClaim(empresaId: string, claim: MLClaim): Promise<void> {
    const tipo = this.mapTipo(claim);
    const detalhe = await this.detalhar(empresaId, claim);
    const status = this.mapStatus(claim, detalhe.responsavel);
    // Prazo que COBRA o vendedor só quando a vez é dele — prazo do comprador
    // (ex.: devolver o produto) fica no detalhe, sem acender "prazo urgente".
    const prazoVendedor =
      detalhe.responsavel === 'respondent' && detalhe.prazo
        ? new Date(detalhe.prazo)
        : !detalhe.responsavel && claim.expiration_date
          ? new Date(claim.expiration_date)
          : undefined;
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
      motivo: detalhe.motivo ?? detalhe.problema ?? claim.status_detail ?? undefined,
      motivoCodigo: claim.reason_id ?? undefined,
      pedidoExternoId: claim.resource === 'order' ? String(claim.resource_id) : undefined,
      valor: detalhe.pedido?.total ?? undefined,
      prazoResposta: prazoVendedor,
      resumo,
      conversationId: eventoEntrante.conversationId,
      metadata: {
        ml_claim: claim,
        ml_detalhe: detalhe,
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

  /**
   * Envia mensagem na reclamação. O destinatário (comprador ou mediador) é o
   * que o ML libera AGORA pro vendedor — lido da claim na hora, porque muda com
   * a etapa. Sem ação de mensagem liberada, explica em vez de mandar pro ML e
   * devolver erro cru. Rota do v1: `actions/send-message` (o `POST /messages`
   * que se usava antes não é a rota de envio).
   */
  async enviarMensagem(
    empresaId: string,
    claimId: string | number,
    texto: string,
  ): Promise<{ externalId?: string }> {
    const claim = await this.obter(empresaId, claimId);
    const para = destinatarioMensagem(acoesDoVendedor(claim.players as Jogador[] | undefined));
    if (!para) {
      throw new BusinessRuleException(
        'O Mercado Livre não está esperando mensagem sua nesta reclamação agora. Confira o andamento no detalhe.',
      );
    }
    const r = await this.ml.post<{ id?: string | number } | null>(
      empresaId,
      `/post-purchase/v1/claims/${claimId}/actions/send-message`,
      { receiver_role: para, message: texto, attachments: [] },
    );
    return { externalId: r?.id ? String(r.id) : undefined };
  }

  // ─── Mapeamento de status/tipo ────────────────────────────────────────

  private mapTipo(claim: MLClaim): MarketplaceIncidentTipo {
    if (claim.stage === 'dispute' || claim.stage === 'mediations') return 'MEDIACAO';
    if (claim.type === 'return' || claim.type === 'change') return 'DEVOLUCAO';
    if (claim.type === 'cancel_purchase') return 'CANCELAMENTO';
    return 'RECLAMACAO';
  }

  private mapStatus(claim: MLClaim, responsavel?: string | null): MarketplaceIncidentStatus {
    switch (claim.status) {
      case 'opened':
        // Aberta não quer dizer "a vez é sua": na 5583814163 o ML já tinha
        // resolvido e esperava o comprador devolver. O `/detail` diz de quem é.
        if (responsavel === 'complainant') return 'AGUARDANDO_COMPRADOR';
        if (responsavel === 'mediator') return 'EM_MEDIACAO';
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
