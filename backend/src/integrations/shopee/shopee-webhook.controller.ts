import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EnvService } from '@config/env.service';
import { Public } from '@shared/decorators/public.decorator';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { ShopeeChatService } from './shopee-chat.service';
import { ShopeeClientService } from './shopee-client.service';
import { ShopeeOAuthService } from './shopee-oauth.service';
import { ShopeeOrdersService } from './shopee-orders.service';
import { ShopeeReturnsService } from './shopee-returns.service';
import { ShopeeSigner } from './shopee-signer';
import type { ShopeeWebhookEnvelope } from './shopee.types';

/**
 * Receiver de push notifications da Shopee.
 *
 * SEGURANÇA:
 *  - Header `Authorization` = HMAC SHA-256 do `<url>|<rawBody>` com `partner_key`
 *  - `url` é a URL COMPLETA configurada no painel (sem query string)
 *  - rawBody preservado pelo Nest via `rawBody: true` em main.ts
 *
 * ROUTING por `code` (push_type):
 *   3  → order status update      → OrdersService
 *   4  → tracking number          → OrdersService (mesma órbita)
 *   6  → return/refund update     → ReturnsService
 *   7  → chat message             → ChatService
 *   15 → return seller proof
 *   16 → dispute escalation       → ReturnsService (status muda)
 *
 * SEMPRE responde 200 — Shopee retentaria em 5xx.
 */
@ApiTags('webhooks')
@Controller('webhooks/shopee')
@Throttle({ default: { limit: 200, ttl: seconds(60) } })
export class ShopeeWebhookController {
  private readonly logger = new Logger(ShopeeWebhookController.name);

  constructor(
    private readonly env: EnvService,
    private readonly oauth: ShopeeOAuthService,
    private readonly chat: ShopeeChatService,
    private readonly returns: ShopeeReturnsService,
    private readonly orders: ShopeeOrdersService,
    private readonly client: ShopeeClientService,
    private readonly antiReplay: WebhookAntiReplayService,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recebe push notifications da Shopee' })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') signature: string | undefined,
    @Body() body: ShopeeWebhookEnvelope,
  ): Promise<{ ok: boolean }> {
    const partnerKey = this.env.get('SHOPEE_PARTNER_KEY');
    const partnerId = this.env.get('SHOPEE_PARTNER_ID');
    const isProd = this.env.isProduction;
    if (!partnerKey || !partnerId) {
      if (isProd) {
        this.logger.error(
          'SHOPEE_PARTNER_KEY/PARTNER_ID ausente em produção — webhook rejeitado',
        );
        throw new UnauthorizedException('webhook secret não configurado');
      }
      this.logger.warn('SHOPEE_PARTNER_KEY ausente (dev) — aceita sem HMAC');
    } else {
      const url = this.fullUrl(req);
      const raw = req.rawBody;
      if (!raw) {
        this.logger.warn('Webhook Shopee sem rawBody — não é possível validar HMAC');
        throw new UnauthorizedException('rawBody ausente');
      }
      const signer = new ShopeeSigner(partnerId, partnerKey);
      if (!signature || !signer.verifyWebhook(url, raw, signature)) {
        this.logger.warn('Webhook Shopee com assinatura inválida — descartado');
        throw new UnauthorizedException('assinatura inválida');
      }

      // Sprint 3 FIX 1: anti-replay. Shopee envia `timestamp` no body (unix seconds).
      const ts = (body as { timestamp?: number })?.timestamp;
      const replay = await this.antiReplay.checkAndMarkWebhook(
        'shopee',
        signature,
        ts,
      );
      if (!replay.fresh) {
        return { ok: true };
      }
    }

    if (!body?.code) {
      this.logger.warn('Webhook Shopee com payload inválido');
      return { ok: false };
    }
    const shopId = body.shop_id ?? body.merchant_id;
    if (!shopId) {
      this.logger.warn('Webhook Shopee sem shop_id/merchant_id');
      return { ok: false };
    }

    const empresaId = await this.oauth.resolverPorShopId(String(shopId));
    if (!empresaId) {
      this.logger.warn(
        `Webhook Shopee shop_id=${shopId} sem IntegracaoConexao — ignorado`,
      );
      return { ok: false };
    }

    try {
      await this.despachar(empresaId, body);
      return { ok: true };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha processando webhook Shopee code=${body.code}: ${m}`);
      return { ok: false };
    }
  }

  private async despachar(empresaId: string, env: ShopeeWebhookEnvelope): Promise<void> {
    switch (env.code) {
      case 3: // order status
      case 4: {
        // tracking
        const orderSn = (env.data?.['ordersn'] as string) ?? (env.data?.['order_sn'] as string);
        if (!orderSn) return;
        const detalhes = await this.orders.obterDetalhes(empresaId, [orderSn]);
        for (const o of detalhes) {
          await this.orders.processarOrder(empresaId, o);
        }
        return;
      }
      case 6:
      case 15:
      case 16: {
        // returns / refunds / seller proof / dispute escalation
        const returnSn =
          (env.data?.['return_sn'] as string) ?? (env.data?.['returnsn'] as string);
        if (!returnSn) return;
        const ret = await this.returns.obter(empresaId, returnSn);
        await this.returns.processarReturn(empresaId, ret);
        return;
      }
      case 7: {
        // chat message
        const conversationId =
          (env.data?.['conversation_id'] as string) ??
          (env.data?.['conversation_id'] as string);
        if (!conversationId) return;
        await this.chat.processarConversation(empresaId, conversationId);
        return;
      }
      default:
        this.logger.debug(`Webhook Shopee code não-tratado: ${env.code}`);
    }
    // referência para evitar warning sobre client não-usado (mantido pra extensões)
    void this.client;
  }

  private fullUrl(req: Request): string {
    // Shopee assina o `url` cadastrado no painel. Reconstruímos a partir da request,
    // usando o `Host` original (sem query string) — o painel não suporta query
    // params na callback URL, então isso é seguro.
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ??
      ((req.socket as { encrypted?: boolean })?.encrypted ? 'https' : 'http');
    const host = req.headers.host;
    const path = req.originalUrl?.split('?')[0] ?? req.url ?? '';
    return `${proto}://${host}${path}`;
  }
}
