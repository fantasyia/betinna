import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Throttle, SkipThrottle, seconds } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@shared/decorators/public.decorator';
import { EnvService } from '@config/env.service';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { EvolutionService } from './evolution.service';
import { EvolutionInboundService } from './evolution-inbound.service';

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: unknown;
}

/**
 * Recebe os eventos do Evolution API (mensagens, conexão, QR). Endpoint @Public.
 *
 * SEGURANÇA — autenticidade do remetente:
 *  - Preferido: segredo no HEADER `x-evolution-webhook-token` (rota `POST
 *    /webhooks/evolution`). URLs vazam em log de proxy/Referer; headers não.
 *  - Legado: token na URL (`POST /webhooks/evolution/:token`) — mantido só pra
 *    instâncias ainda NÃO re-pareadas; some quando todas reconectarem.
 *  - Comparação SEMPRE em tempo constante (timingSafeEqual).
 *  - O Evolution NÃO assina o corpo (não há HMAC pra validar como nos marketplaces);
 *    o segredo compartilhado é o que prova a origem.
 *  - ANTI-REPLAY nas mensagens: dedup por (instância + id) via WebhookAntiReplayService.
 */
@ApiExcludeController()
// AUDITORIA (média): era o ÚNICO receiver de webhook sem @Throttle — ficava capado
// pelos limites GLOBAIS por IP (short 10/s, medium 100/min). O Evolution manda TODO
// o tráfego do WhatsApp de UM único IP: numa rajada (sync de histórico, grupo
// movimentado, campanha) o throttler global devolvia 429 e a mensagem se perdia,
// porque o Evolution não reentrega indefinidamente. Limite próprio e alto, como os
// outros webhooks (OMIE 100/min, ML 200/min) — a autenticidade quem garante é o
// segredo no header, não o rate-limit.
// ⚠️ REVISÃO (11/08): só o @Throttle NÃO bastava. O guard exige `.every()` sobre
// TODOS os buckets, e o app.module documenta explicitamente que "overrides que
// queriam AUMENTAR o cap seguem limitados pelo medium=100/min — pra webhooks
// passarem de 100/min, usar @SkipThrottle nos buckets medium/long". Ou seja: o
// override de 600/min que eu tinha posto era decorativo, o 429 na 101ª msg/min
// continuava. Pulando medium/long, o limite efetivo passa a ser este de fato.
@SkipThrottle({ medium: true, long: true })
@Throttle({ default: { limit: 600, ttl: seconds(60) }, short: { limit: 60, ttl: seconds(1) } })
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  private readonly logger = new Logger(EvolutionWebhookController.name);

  constructor(
    private readonly env: EnvService,
    private readonly inbound: EvolutionInboundService,
    private readonly antiReplay: WebhookAntiReplayService,
  ) {}

  /** Rota NOVA: segredo no header (URL sem token). */
  @Public()
  @Post()
  async receber(
    @Headers(EvolutionService.WEBHOOK_HEADER) headerSecret: string | undefined,
    @Body() body: EvolutionWebhookBody,
  ): Promise<{ ok: boolean }> {
    const esperado = EvolutionService.webhookHeaderSecret(this.env.get('EVOLUTION_API_KEY') || '');
    if (!esperado || !this.segredoIgual(headerSecret, esperado)) {
      throw new UnauthorizedException('webhook secret inválido');
    }
    return this.processar(body);
  }

  /** Rota LEGADO: token na URL — instâncias ainda não re-pareadas. */
  @Public()
  @Post(':token')
  async receberLegacy(
    @Param('token') token: string,
    @Body() body: EvolutionWebhookBody,
  ): Promise<{ ok: boolean }> {
    const esperado = EvolutionService.webhookToken(this.env.get('EVOLUTION_API_KEY') || '');
    if (!esperado || !this.segredoIgual(token, esperado)) {
      throw new UnauthorizedException('webhook token inválido');
    }
    return this.processar(body);
  }

  /** Anti-replay (só mensagens) + repasse pro processamento. Comum às duas rotas. */
  private async processar(body: EvolutionWebhookBody): Promise<{ ok: boolean }> {
    // Anti-replay só pra mensagens — eventos de conexão/QR podem repetir sem
    // efeito colateral. Sem timestamp (o Evolution não manda um confiável): só
    // dedup por id, evitando rejeitar msg legítima atrasada (o poll de fallback
    // não passa por aqui).
    const chaveReplay = this.chaveReplay(body);
    if (chaveReplay) {
      const { fresh } = await this.antiReplay.checkAndMarkWebhook(
        'evolution',
        chaveReplay,
        undefined,
      );
      if (!fresh) return { ok: true }; // replay → ACK sem reprocessar
    }
    // Responde 200 na hora (pro Evolution não re-tentar) e processa em background.
    // AUDITORIA (média): era `void` puro — se o processamento explodisse, o erro
    // sumia num unhandled rejection e a marca de anti-replay ficava gravada, o
    // que fazia qualquer reentrega ser descartada como "replay". Libera a marca
    // no erro, pra reentrega/poll ter chance, e loga em vez de sumir.
    void this.inbound.processarEvento(body).catch(async (err: unknown) => {
      this.logger.error(
        `[evolution] processamento do webhook falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (chaveReplay) {
        await this.antiReplay.releaseWebhook('evolution', chaveReplay).catch(() => undefined);
      }
    });
    return { ok: true };
  }

  /** Comparação em tempo constante (evita timing attack no segredo). */
  private segredoIgual(recebido: string | undefined, esperado: string): boolean {
    if (!recebido) return false;
    const a = Buffer.from(recebido);
    const b = Buffer.from(esperado);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Chave de dedup pra anti-replay — só pra mensagens entrantes (as que viram
   * Message + disparam o bot). `${instance}:${key.id}`. Null pra eventos sem id
   * (connection.update, qrcode.updated) que podem repetir sem problema.
   */
  private chaveReplay(body: EvolutionWebhookBody): string | null {
    if ((body.event ?? '').toLowerCase() !== 'messages.upsert') return null;
    const data = body.data as {
      messages?: Array<{ key?: { id?: string } }>;
      key?: { id?: string };
    };
    // Chave a partir de TODOS os ids do lote (não só o [0]) — senão o anti-replay só cobria a
    // 1ª msg e o lote inteiro era reprocessado a cada reentrega do webhook.
    const msgs = Array.isArray(data?.messages) ? data.messages : data ? [data] : [];
    const ids = msgs.map((m) => m?.key?.id).filter((x): x is string => !!x);
    return ids.length > 0 ? `${body.instance ?? '?'}:${ids.join(',')}` : null;
  }
}
