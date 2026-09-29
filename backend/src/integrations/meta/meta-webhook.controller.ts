import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
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
import { InboxService } from '@modules/inbox/inbox.service';
import { Public } from '@shared/decorators/public.decorator';
import {
  ForbiddenException,
  IntegrationException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
import { WebhookSignatureUtil } from '@shared/http/webhook-signature.util';
import { addBreadcrumb } from '@shared/observability/sentry';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { MetaAppService } from './meta-app.service';
import { MetaLeadgenService } from './meta-leadgen.service';
import type { MetaLeadgenChangeValue } from './meta-leadgen.types';
import { MetaMediaService } from './meta-media.service';
import { MetaOAuthService } from './meta-oauth.service';
import type { MetaMessagingEvent, MetaWebhookEntry, MetaWebhookEnvelope } from './meta.types';

/**
 * Receiver de webhooks da Meta (Messenger + Instagram Direct).
 *
 * UMA URL POR EMPRESA: `/webhooks/meta/:empresaId` (item 13, 29/09). Cada
 * empresa tem o próprio app da Meta (cadastrado em Integrações, servico
 * 'meta_app'), e é essa URL que vai no painel do app dela.
 *
 * GET = verificação inicial (handshake do Meta).
 *   Meta envia `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`.
 *   Comparamos com o verify token DA EMPRESA e devolvemos o challenge.
 *
 * POST = recebimento de eventos.
 *   - HMAC SHA-256 do raw body com o segredo do app DA EMPRESA da URL — antes
 *     de ler o corpo. Empresa sem app cadastrado → 401 (fail-closed).
 *   - Entry de Página/IG que NÃO é da empresa da URL é ignorada: o segredo
 *     prova qual app mandou, não pode servir de passe pra outra empresa.
 *   - Routing por (object × entry.id):
 *       object='page'      → entry.id = pageId   → IntegracaoConexao(servico='facebook')
 *       object='instagram' → entry.id = igUserId → IntegracaoConexao(servico='instagram')
 *   - `entry.changes[].field = 'leadgen'` (Lead Ads) NÃO é mensagem: vai pra
 *     fila, porque o payload traz só o `leadgen_id` e os dados exigem uma ida à
 *     Graph API que não cabe no tempo de resposta do webhook.
 *   - Pra cada messaging event, descarta ecos (is_echo) e gera msg entrante
 *     no InboxService.
 *
 * SEMPRE responde 200 — Meta retentaria por horas em qualquer erro 5xx.
 */
/** id de empresa (cuid) — barra lixo na URL antes de ir ao banco. */
const ID_VALIDO = /^[a-z0-9]{20,40}$/;

@ApiTags('webhooks')
@Controller('webhooks/meta')
// 200 req/min — Meta envia bursts em mass-message campaigns
@Throttle({ default: { limit: 200, ttl: seconds(60) } })
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    private readonly apps: MetaAppService,
    private readonly inbox: InboxService,
    private readonly oauth: MetaOAuthService,
    private readonly antiReplay: WebhookAntiReplayService,
    private readonly media: MetaMediaService,
    private readonly leadgen: MetaLeadgenService,
  ) {}

  // ─── Verificação (GET handshake) ─────────────────────────────────────

  @Public()
  @Get(':empresaId')
  @ApiOperation({ summary: 'Meta GET handshake (hub.challenge) — por empresa' })
  async verify(
    @Param('empresaId') empresaId: string,
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): Promise<string> {
    const app = ID_VALIDO.test(empresaId) ? await this.apps.talvez(empresaId) : null;
    const expected = app?.verifyToken;
    if (!expected) {
      this.logger.warn(`Meta handshake: empresa ${empresaId} sem App da Meta cadastrado`);
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
  @Post(':empresaId')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('empresaId') empresaId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    // Sem app cadastrado não há segredo — e sem segredo NADA entra (antes, em
    // dev, entrava sem HMAC; com o segredo por empresa não existe esse modo).
    const app = ID_VALIDO.test(empresaId) ? await this.apps.talvez(empresaId) : null;
    const secret = app?.appSecret;
    if (!secret) {
      this.logger.warn(`Webhook Meta: empresa ${empresaId} sem App da Meta cadastrado — rejeitado`);
      throw new UnauthorizedException('webhook secret não configurado');
    }
    {
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

    let falhaProcessamento = false;
    for (const entry of envelope.entry) {
      try {
        await this.processarEntry(empresaId, canal, entry);
      } catch (err) {
        falhaProcessamento = true;
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha processando entry ${entry.id}: ${m}`);
      }
    }
    if (falhaProcessamento) {
      // Ao contrário dos marketplaces (que têm cron de fallback de 10min re-puxando),
      // o Meta entrega SÓ por webhook — engolir o erro em 200 = mensagem perdida.
      // Liberamos o anti-replay e devolvemos 5xx pro Meta reenviar (bounded: até 8x/24h);
      // a idempotência por externalId protege as entries que já processaram no retry.
      if (signature) await this.antiReplay.releaseWebhook('meta', signature);
      throw new IntegrationException('Falha transitória processando webhook Meta — reenviar');
    }
    return { ok: true };
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private async processarEntry(
    empresaId: string,
    canal: MessageChannel,
    entry: MetaWebhookEntry,
  ): Promise<void> {
    const accountId = entry.id;
    const servico = canal === 'FACEBOOK' ? 'facebook' : 'instagram';

    // Lead Ads chega neste MESMO webhook, mas em `changes` (não em `messaging`)
    // e sem dado nenhum do lead. Só enfileira: buscar na Graph aqui estouraria o
    // tempo de resposta que o Meta espera.
    const mudancasLeadgen = (entry.changes ?? []).filter((c) => c.field === 'leadgen');
    if (mudancasLeadgen.length) {
      await this.processarLeadgen(empresaId, servico, accountId, mudancasLeadgen);
    }

    const resolved = await this.oauth.resolverPorAccount(servico, accountId);
    if (!resolved) {
      this.logger.warn(
        `Webhook Meta ${canal}: conta ${accountId} sem IntegracaoConexao — ignorado`,
      );
      return;
    }
    if (resolved.empresaId !== empresaId) {
      this.logger.warn(
        `Webhook Meta ${canal}: conta ${accountId} é de outra empresa, não de ${empresaId} — ignorado`,
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

  /**
   * Enfileira cada lead do formulário nativo. NÃO engole erro: o caller devolve
   * 5xx e o Meta reentrega — perder um lead pago em silêncio é pior que uma
   * reentrega.
   */
  private async processarLeadgen(
    empresaId: string,
    servico: 'facebook' | 'instagram',
    accountId: string,
    mudancas: Array<{ field: string; value: unknown }>,
  ): Promise<void> {
    // Lead Ads é da PÁGINA. `object='instagram'` não entrega leadgen; se vier,
    // o accountId é um IG user id e não resolveria conexão de facebook.
    if (servico !== 'facebook') {
      this.logger.warn(`Webhook leadgen fora de object='page' (${servico}) — ignorado`);
      return;
    }
    const resolved = await this.oauth.resolverPorAccount('facebook', accountId);
    if (!resolved) {
      this.logger.warn(`Webhook leadgen: página ${accountId} sem IntegracaoConexao — ignorado`);
      return;
    }
    if (resolved.empresaId !== empresaId) {
      this.logger.warn(
        `Webhook leadgen: página ${accountId} é de outra empresa, não de ${empresaId} — ignorado`,
      );
      return;
    }
    for (const mudanca of mudancas) {
      const v = mudanca.value as MetaLeadgenChangeValue | undefined;
      if (!v?.leadgen_id) {
        this.logger.warn('Webhook leadgen sem leadgen_id — ignorado');
        continue;
      }
      await this.leadgen.enfileirar({
        empresaId: resolved.empresaId,
        leadgenId: String(v.leadgen_id),
        pageId: String(v.page_id ?? accountId),
        formId: v.form_id ? String(v.form_id) : undefined,
        adId: v.ad_id ? String(v.ad_id) : undefined,
        adgroupId: v.adgroup_id ? String(v.adgroup_id) : undefined,
        createdTime: typeof v.created_time === 'number' ? v.created_time : undefined,
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
