import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EnvService } from '@config/env.service';
import { ML_WEBHOOK_IPS_DEFAULT, normalizeIp } from '../../constants/providers';
import { Public } from '@shared/decorators/public.decorator';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { MLOAuthService } from './ml-oauth.service';
import { MLClaimsService } from './ml-claims.service';
import { MLMessagesService } from './ml-messages.service';
import { MLOrdersService } from './ml-orders.service';
import { MLQuestionsService } from './ml-questions.service';
import type { MLWebhookNotification, MLTopic } from './ml.types';

/**
 * Receiver de webhooks do Mercado Livre.
 *
 * O ML envia POST pra um único endpoint com payload do tipo:
 *   { _id, resource, user_id, topic, application_id, attempts, sent, received }
 *
 * Topics relevantes pro SAC:
 *   - questions               : pergunta nova em anúncio
 *   - messages                : nova mensagem em chat pós-venda
 *   - orders_v2               : pedido novo/atualizado
 *   - claims | post_purchase_claims : reclamação aberta/atualizada
 *   - items                   : produto alterado (ignoramos — OMIE é master)
 *
 * SEGURANÇA:
 *  - ML não usa HMAC. Validamos por IP whitelist (config via env).
 *  - Em DEV (whitelist vazia) aceitamos qualquer IP com warning.
 *  - Resposta SEMPRE 200/204 — ML retentaria por horas em 5xx.
 *
 * IDEMPOTÊNCIA:
 *  - Cada notification tem `_id` único.
 *  - Em vez de cache em memória, deixamos os services internos garantirem
 *    idempotência via `externalId` único nas Messages/Incidents.
 *
 * O webhook recupera o resource ID do `resource` (ex: `/questions/1234`) e
 * dispara `obter` + `processar` no service apropriado, que faz upsert.
 */
@ApiTags('webhooks')
@Controller('webhooks/mercadolivre')
@Throttle({ default: { limit: 200, ttl: seconds(60) } })
export class MLWebhookController {
  private readonly logger = new Logger(MLWebhookController.name);

  constructor(
    private readonly env: EnvService,
    private readonly oauth: MLOAuthService,
    private readonly questions: MLQuestionsService,
    private readonly messages: MLMessagesService,
    private readonly orders: MLOrdersService,
    private readonly claims: MLClaimsService,
    private readonly antiReplay: WebhookAntiReplayService,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recebe notificações do Mercado Livre' })
  async receive(
    @Req() req: Request,
    @Body() body: MLWebhookNotification,
  ): Promise<{ ok: boolean }> {
    if (!this.aceitaIp(req)) {
      this.logger.warn(`Webhook ML rejeitado por IP: ${this.extrairIp(req)}`);
      return { ok: false };
    }
    if (!body?.topic || !body.resource || !body.user_id) {
      this.logger.warn('Webhook ML com payload inválido');
      return { ok: false };
    }

    const empresaId = await this.oauth.resolverPorUserId(String(body.user_id));
    if (!empresaId) {
      this.logger.warn(`Webhook ML user_id=${body.user_id} sem IntegracaoConexao — ignorado`);
      return { ok: false };
    }

    // Sprint 3 FIX 1: anti-replay. ML não tem HMAC, mas envia `_id` único +
    // `sent` (timestamp ISO). Usamos `_id` como "signature" para dedup.
    // Combinado com IP whitelist (Sprint 1), essa é nossa proteção máxima.
    const replay = await this.antiReplay.checkAndMarkWebhook(
      'mercadolivre',
      body._id ?? `${body.user_id}:${body.resource}`,
      body.sent,
    );
    if (!replay.fresh) {
      return { ok: true };
    }

    // Processamento async (mas aguardamos pra que erros sejam logados na request)
    try {
      await this.despachar(empresaId, body);
      return { ok: true };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Falha processando webhook ML (topic=${body.topic} resource=${body.resource}): ${m}`,
      );
      // Retornamos 200 mesmo assim — não queremos ML retentando em erros nossos
      return { ok: false };
    }
  }

  // ─── Routing ─────────────────────────────────────────────────────────

  private async despachar(empresaId: string, n: MLWebhookNotification): Promise<void> {
    const topic = n.topic as MLTopic;
    const id = this.extrairIdRecurso(n.resource);
    if (!id) {
      this.logger.warn(`Webhook ML resource sem ID: ${n.resource}`);
      return;
    }

    switch (topic) {
      case 'questions':
      case 'marketplace_questions': {
        const q = await this.questions.obter(empresaId, id);
        await this.questions.processarQuestion(empresaId, q);
        return;
      }
      case 'messages':
      case 'marketplace_messages': {
        // resource = `/messages/packs/{packId}/sellers/{sellerId}` ou similar
        const m = n.resource.match(/\/packs\/(\d+)\/sellers\/(\d+)/);
        if (m) {
          await this.messages.processarPack(empresaId, m[1], m[2]);
        } else {
          this.logger.warn(`Webhook ML messages resource não-reconhecido: ${n.resource}`);
        }
        return;
      }
      case 'orders_v2':
      case 'marketplace_orders': {
        const order = await this.orders.obter(empresaId, id);
        await this.orders.processarOrder(empresaId, order);
        return;
      }
      case 'claims':
      case 'post_purchase_claims': {
        const claim = await this.claims.obter(empresaId, id);
        await this.claims.processarClaim(empresaId, claim);
        return;
      }
      case 'items':
        // OMIE é master pra catálogo. Ignoramos.
        return;
      default:
        this.logger.debug(`Webhook ML topic não-tratado: ${topic}`);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private extrairIdRecurso(resource: string): string | null {
    // Padrões: "/questions/123", "/orders/123", "/claims/123", "/messages/packs/{p}/sellers/{s}"
    const segments = resource.split('/').filter(Boolean);
    // Pega o último segmento numérico (cobre todos os casos mais comuns)
    for (let i = segments.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(segments[i])) return segments[i];
    }
    return null;
  }

  private aceitaIp(req: Request): boolean {
    const configured = (this.env.get('ML_WEBHOOK_IP_WHITELIST') ?? '')
      .split(',')
      .map((s) => normalizeIp(s))
      .filter(Boolean);
    // Fallback aos IPs documentados em src/constants/providers.ts quando env vazio
    const whitelist = configured.length > 0 ? configured : Array.from(ML_WEBHOOK_IPS_DEFAULT);

    // Em produção, whitelist VAZIA é rejeição. O env schema já bloqueia isso
    // no boot, mas defesa em profundidade aqui também.
    if (whitelist.length === 0) {
      if (this.env.isProduction) {
        this.logger.error('ML_WEBHOOK_IP_WHITELIST vazia em produção — webhook rejeitado');
        return false;
      }
      this.logger.warn('ML_WEBHOOK_IP_WHITELIST vazia (dev) — aceita qualquer IP');
      return true;
    }

    const ip = this.extrairIp(req);
    return whitelist.includes(ip);
  }

  /**
   * Extrai o IP do cliente. Confia no `req.ip` resolvido pelo Express com
   * `trust proxy=1` (configurado em main.ts). Isso significa que o Express já
   * processou o X-Forwarded-For respeitando apenas 1 hop confiável, evitando
   * spoofing direto via header.
   *
   * Antes desta auditoria (2026-05-15), o parsing manual de XFF permitia que
   * qualquer atacante enviasse `X-Forwarded-For: <IP-do-ML>` e contornasse
   * a whitelist. Agora isso só funciona se vier do proxy confiável.
   */
  private extrairIp(req: Request): string {
    return normalizeIp(req.ip ?? req.socket?.remoteAddress ?? '');
  }
}
