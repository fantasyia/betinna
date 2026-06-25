import { Body, Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
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
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
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
    void this.inbound.processarEvento(body);
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
