import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import type { MessageChannel } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EnvService } from '@config/env.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { Public } from '@shared/decorators/public.decorator';
import { ForbiddenException, UnauthorizedException } from '@shared/errors/app-exception';
import { WebhookSignatureUtil } from '@shared/http/webhook-signature.util';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { MetaOAuthService } from './meta-oauth.service';
import type { MetaMessagingEvent, MetaWebhookEntry, MetaWebhookEnvelope } from './meta.types';

/**
 * Receiver de webhooks da Meta (Messenger + Instagram Direct).
 *
 * GET = verificação inicial (handshake do Meta).
 *   Meta envia `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`.
 *   Comparamos o token e devolvemos o challenge em plain text.
 *
 * POST = recebimento de eventos.
 *   - Verificação HMAC SHA-256 do raw body com `META_GRAPH_APP_SECRET`
 *   - Routing por (object × entry.id):
 *       object='page'      → entry.id = pageId   → IntegracaoConexao(servico='facebook')
 *       object='instagram' → entry.id = igUserId → IntegracaoConexao(servico='instagram')
 *   - Pra cada messaging event, descarta ecos (is_echo) e gera msg entrante
 *     no InboxService.
 *
 * SEMPRE responde 200 — Meta retentaria por horas em qualquer erro 5xx.
 */
@ApiTags('webhooks')
@Controller('webhooks/meta')
// 200 req/min — Meta envia bursts em mass-message campaigns
@Throttle({ default: { limit: 200, ttl: seconds(60) } })
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    private readonly env: EnvService,
    private readonly inbox: InboxService,
    private readonly oauth: MetaOAuthService,
    private readonly antiReplay: WebhookAntiReplayService,
  ) {}

  // ─── Verificação (GET handshake) ─────────────────────────────────────

  @Public()
  @Get()
  @ApiOperation({ summary: 'Meta GET handshake (hub.challenge)' })
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    const expected = this.env.get('META_GRAPH_VERIFY_TOKEN');
    if (!expected) {
      this.logger.warn('META_GRAPH_VERIFY_TOKEN não configurado — handshake rejeitado');
      throw new ForbiddenException('verify token não configurado');
    }
    if (mode !== 'subscribe' || token !== expected) {
      this.logger.warn(`Meta verify falhou: mode=${mode}`);
      throw new ForbiddenException('verify token inválido');
    }
    return challenge ?? '';
  }

  // ─── Recebimento (POST events) ───────────────────────────────────────

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    const secret = this.env.get('META_GRAPH_APP_SECRET');
    const isProd = this.env.isProduction;
    if (!secret) {
      if (isProd) {
        this.logger.error('META_GRAPH_APP_SECRET ausente em produção — webhook rejeitado');
        throw new UnauthorizedException('webhook secret não configurado');
      }
      this.logger.warn('META_GRAPH_APP_SECRET ausente (dev) — webhook aceito sem HMAC');
    } else {
      const rawBody = req.rawBody;
      if (!rawBody) {
        this.logger.warn('Webhook Meta sem rawBody — não é possível validar HMAC');
        throw new UnauthorizedException('rawBody ausente');
      }
      if (!signature || !WebhookSignatureUtil.verifyHmacSha256(rawBody, signature, secret)) {
        this.logger.warn('Meta webhook com assinatura inválida — descartado');
        throw new UnauthorizedException('assinatura inválida');
      }

      // Sprint 3 FIX 1: anti-replay. Meta envia `entry[].time` (timestamp do evento).
      const envelopeForTs = body as MetaWebhookEnvelope;
      const ts = envelopeForTs?.entry?.[0]?.time;
      const replay = await this.antiReplay.checkAndMarkWebhook('meta', signature, ts);
      if (!replay.fresh) {
        return { ok: true };
      }
    }

    const envelope = body as MetaWebhookEnvelope;
    if (!envelope?.object || !Array.isArray(envelope.entry)) {
      this.logger.warn('Meta webhook com payload inválido');
      return { ok: false };
    }

    const canal: MessageChannel | null =
      envelope.object === 'page'
        ? 'FACEBOOK'
        : envelope.object === 'instagram'
          ? 'INSTAGRAM'
          : null;
    if (!canal) {
      this.logger.warn(`Meta webhook com object desconhecido: ${envelope.object}`);
      return { ok: false };
    }

    for (const entry of envelope.entry) {
      try {
        await this.processarEntry(canal, entry);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha processando entry ${entry.id}: ${m}`);
      }
    }
    return { ok: true };
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private async processarEntry(canal: MessageChannel, entry: MetaWebhookEntry): Promise<void> {
    const accountId = entry.id;
    const servico = canal === 'FACEBOOK' ? 'facebook' : 'instagram';
    const resolved = await this.oauth.resolverPorAccount(servico, accountId);
    if (!resolved) {
      this.logger.warn(
        `Webhook Meta ${canal}: conta ${accountId} sem IntegracaoConexao — ignorado`,
      );
      return;
    }

    const events: MetaMessagingEvent[] = entry.messaging ?? [];
    for (const ev of events) {
      if (!ev.message) continue; // só nos interessa mensagens; ignoramos delivery/read no MVP
      if (ev.message.is_echo || ev.is_echo) continue; // ecos das nossas próprias respostas
      // sender.id é o PSID do usuário (Messenger) ou IGSID (Instagram)
      const peerId = ev.sender?.id;
      if (!peerId) continue;

      const { conteudo, tipo, mediaUrl, mediaMime } = this.extrairConteudo(ev);
      if (!conteudo && tipo === 'TEXT') continue;

      await this.inbox.processarMensagemEntrante({
        empresaId: resolved.empresaId,
        canal,
        peerId,
        tipo,
        conteudo,
        externalId: ev.message.mid,
        data: ev.timestamp ? new Date(ev.timestamp) : undefined,
        mediaUrl,
        mediaMime,
        meta: { accountId, raw: ev.message },
      });
    }
  }

  private extrairConteudo(ev: MetaMessagingEvent): {
    conteudo: string;
    tipo: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'LOCATION';
    mediaUrl?: string;
    mediaMime?: string;
  } {
    const msg = ev.message;
    if (!msg) return { conteudo: '', tipo: 'TEXT' };
    if (msg.text) return { conteudo: msg.text, tipo: 'TEXT' };
    const att = msg.attachments?.[0];
    if (!att) return { conteudo: '', tipo: 'TEXT' };
    switch (att.type) {
      case 'image':
        return { conteudo: '[imagem]', tipo: 'IMAGE', mediaUrl: att.payload?.url };
      case 'video':
        return { conteudo: '[vídeo]', tipo: 'VIDEO', mediaUrl: att.payload?.url };
      case 'audio':
        return { conteudo: '[áudio]', tipo: 'AUDIO', mediaUrl: att.payload?.url };
      case 'file':
        return { conteudo: '[arquivo]', tipo: 'DOCUMENT', mediaUrl: att.payload?.url };
      case 'location': {
        const c = att.payload?.coordinates;
        return {
          conteudo: c ? `[localização] ${c.lat},${c.long}` : '[localização]',
          tipo: 'LOCATION',
        };
      }
      default:
        return { conteudo: `[${att.type}]`, tipo: 'TEXT' };
    }
  }
}
