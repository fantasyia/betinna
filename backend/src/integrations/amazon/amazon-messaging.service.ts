import { Injectable, Logger } from '@nestjs/common';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { AmazonClientService } from './amazon-client.service';
import type {
  AmazonMessagingActionsResponse,
  AmazonPermittedAction,
} from './amazon.types';

/**
 * Messaging API da Amazon SP-API.
 *
 * Diferente de ML/Shopee, Amazon **não tem chat livre**. Cada interação é
 * uma "Permitted Action" estruturada e específica, e nem todas estão
 * disponíveis pra um dado pedido — depende do status, marketplace e regras
 * do Buyer-Seller Messaging.
 *
 * Fluxo:
 *  1. `listarAcoesPermitidas(orderId)` → quais ações estão disponíveis
 *  2. Chama o método específico (`confirmarEntrega`, `reportarProblema`, etc.)
 *
 * Ações implementadas (foco SAC):
 *  - confirmDeliveryDetails  → texto livre solicitando confirmação
 *  - confirmOrderDetails     → texto livre confirmando detalhes
 *  - unexpectedProblem       → texto livre reportando problema
 *  - getCustomerInformation  → solicitar info ao buyer (sem texto)
 *
 * Limitações da Amazon:
 *  - Não há resposta INBOUND do comprador via API (ele responde direto no
 *    Amazon, fora do nosso sistema) — só vemos mudanças no pedido
 *  - Textos têm restrições de conteúdo (sem links externos, sem emojis em
 *    alguns marketplaces, sem CPF, sem telefone fora do contexto)
 *  - NFe NÃO é responsabilidade deste sistema (sai pelo hub fiscal externo)
 */
@Injectable()
export class AmazonMessagingService {
  private readonly logger = new Logger(AmazonMessagingService.name);

  constructor(private readonly amazon: AmazonClientService) {}

  /** Lista actions permitidas pra um pedido específico. */
  async listarAcoesPermitidas(
    empresaId: string,
    amazonOrderId: string,
  ): Promise<AmazonPermittedAction[]> {
    const r = await this.amazon.get<AmazonMessagingActionsResponse>(
      empresaId,
      `/messaging/v1/orders/${encodeURIComponent(amazonOrderId)}`,
      { marketplaceIds: this.amazon.marketplaceId },
    );
    const links = r._links?.actions ?? [];
    return links.map((l) => l.name);
  }

  async confirmarEntrega(
    empresaId: string,
    amazonOrderId: string,
    texto: string,
  ): Promise<void> {
    await this.postAction(empresaId, amazonOrderId, 'confirmDeliveryDetails', { text: texto });
  }

  async confirmarPedido(
    empresaId: string,
    amazonOrderId: string,
    texto: string,
  ): Promise<void> {
    await this.postAction(empresaId, amazonOrderId, 'confirmOrderDetails', { text: texto });
  }

  /**
   * Reporta problema inesperado. Use quando precisa avisar o comprador sobre
   * algo errado (item indisponível, atraso significativo, etc.).
   */
  async reportarProblema(
    empresaId: string,
    amazonOrderId: string,
    texto: string,
  ): Promise<void> {
    await this.postAction(empresaId, amazonOrderId, 'unexpectedProblem', { text: texto });
  }

  /** Solicita info ao comprador (uso comum: confirmar endereço). */
  async solicitarInformacao(
    empresaId: string,
    amazonOrderId: string,
  ): Promise<void> {
    await this.postAction(empresaId, amazonOrderId, 'getCustomerInformation', {});
  }

  /**
   * Envio "genérico" via roteamento de texto livre.
   * Tenta `confirmDeliveryDetails` primeiro (action mais permissiva). Se a
   * lista de ações permitidas não inclui, tenta `unexpectedProblem`. Falha
   * se nenhuma estiver disponível.
   *
   * Usado pelo adapter da Inbox quando o operador escreve texto livre.
   */
  async enviarTextoLivre(
    empresaId: string,
    amazonOrderId: string,
    texto: string,
  ): Promise<{ acaoUsada: AmazonPermittedAction }> {
    const permitidas = await this.listarAcoesPermitidas(empresaId, amazonOrderId).catch(() => []);
    const candidatos: AmazonPermittedAction[] = [
      'confirmDeliveryDetails',
      'confirmOrderDetails',
      'unexpectedProblem',
    ];
    const permitidasSet = new Set<string>(permitidas);
    const escolha = candidatos.find((a) => permitidasSet.has(a));
    if (!escolha) {
      throw new IntegrationException(
        `Amazon pedido ${amazonOrderId} não permite envio de texto livre nas ações disponíveis: ${permitidas.join(', ') || '(nenhuma)'}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    await this.postAction(empresaId, amazonOrderId, escolha, { text: texto });
    return { acaoUsada: escolha };
  }

  // ─── Interno ──────────────────────────────────────────────────────────

  private async postAction(
    empresaId: string,
    amazonOrderId: string,
    action: AmazonPermittedAction,
    body: unknown,
  ): Promise<void> {
    await this.amazon.post<unknown>(
      empresaId,
      `/messaging/v1/orders/${encodeURIComponent(amazonOrderId)}/messages/${action}`,
      body,
      { marketplaceIds: this.amazon.marketplaceId },
    );
    this.logger.log(`Amazon messaging ${action} → ${amazonOrderId}`);
  }
}
