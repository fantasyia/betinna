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
import { timingSafeEqual } from 'node:crypto';
import { Throttle, seconds } from '@nestjs/throttler';
import type { MessageChannel } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EnvService } from '@config/env.service';
import { InboxService } from '@modules/inbox/inbox.service';
import { Public } from '@shared/decorators/public.decorator';
import { ForbiddenException, UnauthorizedException } from '@shared/errors/app-exception';
import { WebhookSignatureUtil } from '@shared/http/webhook-signature.util';
import { addBreadcrumb } from '@shared/observability/sentry';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { MetaMediaService } from './meta-media.service';
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
    private readonly media: MetaMediaService,
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
    // Comparação constant-time (consistente com evolution-webhook/auth-bootstrap do repo).
    const tokenOk = (() => {
      if (typeof token !== 'string') return false;
      const a = Buffer.from(token);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    })();
    if (mode !== 'subscribe' || !tokenOk) {
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
        addBreadcrumb('webhook', 'meta-invalid-signature', {}, 'warning');
        this.logger.warn('Meta webhook com assinatura inválida — descartado');
        throw new UnauthorizedException('assinatura inválida');
      }
      addBreadcrumb('webhook', 'meta-signature-ok');

      // Anti-replay por dedup de assinatura (SETNX). NÃO passamos `entry[].time`: é o
      // tempo do EVENTO (não da requisição), então o skew de 5min do anti-replay
      // rejeitaria com 401 um evento legítimo entregue/reentregue >5min depois — e o Meta
      // reenviaria o MESMO entry.time, perdendo a mensagem pra sempre.
      const replay = await this.antiReplay.checkAndMarkWebhook('meta', signature, undefined);
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

      const { conteudo, tipo, mediaUrl: cdnUrl, mediaMime } = this.extrairConteudo(ev);
      if (!conteudo && tipo === 'TEXT') continue;

      // Mídia: baixa do CDN da Meta e arquiva no Supabase Storage (best-effort).
      // URLs do CDN expiram — persistindo garantimos histórico durável.
      let mediaUrl: string | undefined = cdnUrl;
      let mimeFinal = mediaMime;
      if (
        cdnUrl &&
        (canal === 'FACEBOOK' || canal === 'INSTAGRAM') &&
        (tipo === 'IMAGE' || tipo === 'VIDEO' || tipo === 'AUDIO' || tipo === 'DOCUMENT')
      ) {
        const stored = await this.media.baixarEArmazenar({
          cdnUrl,
          empresaId: resolved.empresaId,
          canal,
          peerId,
          msgId: ev.message.mid,
        });
        if (stored) {
          mediaUrl = stored.storagePath;
          if (!mimeFinal && stored.mime) mimeFinal = stored.mime;
        }
        // se falhou, mantém cdnUrl como fallback temporário
      }

      await this.inbox.processarMensagemEntrante({
        empresaId: resolved.empresaId,
        canal,
        peerId,
        tipo,
        conteudo,
        externalId: ev.message.mid,
        data: ev.timestamp ? new Date(ev.timestamp) : undefined,
        mediaUrl,
        mediaMime: mimeFinal,
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
