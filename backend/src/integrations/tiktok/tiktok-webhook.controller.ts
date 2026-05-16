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
import { TikTokOAuthService } from './tiktok-oauth.service';
import { TikTokOrdersService } from './tiktok-orders.service';
import { TikTokReturnsService } from './tiktok-returns.service';
import { TikTokSigner } from './tiktok-signer';
import type { TikTokWebhookEnvelope } from './tiktok.types';

/**
 * Receiver de webhooks da TikTok Shop.
 *
 * SEGURANÇA:
 *  - Header `x-tts-signature` = HMAC SHA-256 de `<app_key><timestamp><rawBody>`
 *  - `timestamp` vem em header `x-timestamp`
 *  - rawBody preservado pelo Nest via `rawBody: true` em main.ts
 *
 * ROUTING por `type`:
 *  - ORDER_STATUS_CHANGE      → OrdersService
 *  - RETURN_STATUS_CHANGE     → ReturnsService
 *  - REVERSE_ORDER_STATUS_CHANGE → ReturnsService (mesmo target)
 *  - SHIPMENT_INFO_CHANGE     → OrdersService (status muda)
 *
 * SEMPRE responde 200 — TikTok retentaria em 5xx.
 */
@ApiTags('webhooks')
@Controller('webhooks/tiktok')
@Throttle({ default: { limit: 200, ttl: seconds(60) } })
export class TikTokWebhookController {
  private readonly logger = new Logger(TikTokWebhookController.name);

  constructor(
    private readonly env: EnvService,
    private readonly oauth: TikTokOAuthService,
    private readonly orders: TikTokOrdersService,
    private readonly returns: TikTokReturnsService,
    private readonly antiReplay: WebhookAntiReplayService,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recebe webhooks TikTok Shop' })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-tts-signature') signature: string | undefined,
    @Headers('x-timestamp') timestamp: string | undefined,
    @Body() body: TikTokWebhookEnvelope,
  ): Promise<{ ok: boolean }> {
    const appKey = this.env.get('TIKTOK_APP_KEY');
    const appSecret = this.env.get('TIKTOK_APP_SECRET');
    const isProd = this.env.isProduction;
    if (!appKey || !appSecret) {
      if (isProd) {
        this.logger.error('TIKTOK_APP_KEY/APP_SECRET ausente em produção — webhook rejeitado');
        throw new UnauthorizedException('webhook secret não configurado');
      }
      this.logger.warn('TIKTOK_APP_SECRET ausente (dev) — aceita sem HMAC');
    } else {
      const raw = req.rawBody;
      if (!raw) {
        this.logger.warn('Webhook TikTok sem rawBody — não é possível validar HMAC');
        throw new UnauthorizedException('rawBody ausente');
      }
      const signer = new TikTokSigner(appKey, appSecret);
      if (!signature || !signer.verifyWebhook(raw, signature, timestamp)) {
        this.logger.warn('Webhook TikTok com assinatura inválida — descartado');
        throw new UnauthorizedException('assinatura inválida');
      }

      // Sprint 3 FIX 1: anti-replay. TikTok envia `x-timestamp` (unix seconds).
      const replay = await this.antiReplay.checkAndMarkWebhook('tiktok', signature, timestamp);
      if (!replay.fresh) {
        return { ok: true };
      }
    }

    if (!body?.type) {
      this.logger.warn('Webhook TikTok com payload inválido');
      return { ok: false };
    }
    const shopId = body.shop_id;
    if (!shopId) {
      this.logger.warn('Webhook TikTok sem shop_id');
      return { ok: false };
    }

    const empresaId = await this.oauth.resolverPorShopId(String(shopId));
    if (!empresaId) {
      this.logger.warn(`Webhook TikTok shop_id=${shopId} sem IntegracaoConexao — ignorado`);
      return { ok: false };
    }

    try {
      await this.despachar(empresaId, body);
      return { ok: true };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha processando webhook TikTok type=${body.type}: ${m}`);
      return { ok: false };
    }
  }

  private async despachar(empresaId: string, env: TikTokWebhookEnvelope): Promise<void> {
    switch (env.type) {
      case 'ORDER_STATUS_CHANGE':
      case 'SHIPMENT_INFO_CHANGE': {
        const orderId = (env.data?.['order_id'] as string) ?? (env.data?.['id'] as string);
        if (!orderId) return;
        const detalhes = await this.orders.obterDetalhes(empresaId, [orderId]);
        for (const o of detalhes) {
          await this.orders.processarOrder(empresaId, o);
        }
        return;
      }
      case 'RETURN_STATUS_CHANGE':
      case 'REVERSE_ORDER_STATUS_CHANGE': {
        const returnId =
          (env.data?.['return_id'] as string) ??
          (env.data?.['return_record_id'] as string) ??
          (env.data?.['reverse_order_id'] as string);
        if (!returnId) return;
        const ret = await this.returns.obter(empresaId, returnId);
        if (ret) await this.returns.processarReturn(empresaId, ret);
        return;
      }
      default:
        this.logger.debug(`Webhook TikTok type não-tratado: ${env.type}`);
    }
  }
}
