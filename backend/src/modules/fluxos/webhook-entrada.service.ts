import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import {
  AppException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { WebhookSignatureUtil } from '@shared/http/webhook-signature.util';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { FluxoEventBusService } from './fluxo-event-bus.service';

/** Teto de POSTs por token por minuto (rate-limit antes do lookup no banco). */
const RL_MAX_POR_MIN = 300;
/** Secret dummy p/ o caminho de token inexistente — mantém o custo do HMAC constante. */
const DUMMY_SECRET = '0'.repeat(64);

export interface ReceberWebhookInput {
  token: string;
  rawBody: Buffer | undefined;
  signature: string | undefined;
  idempotencyKey?: string;
  timestamp?: string;
}

/**
 * WebhookEntradaService — webhooks de ENTRADA por empresa.
 *
 * Segurança (endurecimento 2026-06, lição do bug #4 do Evolution):
 *  - segredo HMAC POR-TENANT (não global); token na URL é só ROTEADOR.
 *  - auth = HMAC-SHA256(rawBody) no header, comparado em timingSafeEqual.
 *  - resposta uniforme p/ token inexistente E assinatura inválida (sem oráculo).
 *  - anti-replay (Redis) + idempotência forte (WebhookRecebimento @@unique).
 *  - rate-limit por token ANTES do lookup no banco.
 */
@Injectable()
export class WebhookEntradaService {
  private readonly logger = new Logger(WebhookEntradaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: FluxoEventBusService,
    private readonly redis: RedisService,
    private readonly antiReplay: WebhookAntiReplayService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = getCallerEmpresaId(user);
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  async criar(
    user: AuthenticatedUser,
    nome: string,
  ): Promise<{ id: string; nome: string; token: string; secret: string }> {
    const empresaId = this.requireEmpresa(user);
    const token = randomBytes(24).toString('hex');
    const secret = randomBytes(32).toString('hex');
    const wh = await this.prisma.webhookEntrada.create({
      data: { empresaId, nome, token, secret, ativo: true },
      select: { id: true, nome: true, token: true },
    });
    this.logger.log(`Webhook de entrada criado: ${wh.id} (${nome}) — empresa ${empresaId}`);
    // secret retornado UMA vez (estilo Stripe) — nunca mais é exposto.
    return { ...wh, secret };
  }

  /** Rotaciona o segredo HMAC (secret vazado → gira sem trocar a URL/token). */
  async rotacionarSecret(user: AuthenticatedUser, id: string): Promise<{ secret: string }> {
    const empresaId = this.requireEmpresa(user);
    const secret = randomBytes(32).toString('hex');
    const r = await this.prisma.webhookEntrada.updateMany({
      where: { id, empresaId },
      data: { secret },
    });
    if (r.count === 0) throw new NotFoundException('Webhook', id);
    return { secret };
  }

  async listar(user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    // NUNCA seleciona `secret` — ele só aparece no criar()/rotacionar().
    return this.prisma.webhookEntrada.findMany({
      where: { empresaId },
      orderBy: { criadoEm: 'desc' },
      select: { id: true, nome: true, token: true, ativo: true, criadoEm: true },
    });
  }

  async remover(user: AuthenticatedUser, id: string): Promise<void> {
    const empresaId = this.requireEmpresa(user);
    const r = await this.prisma.webhookEntrada.deleteMany({ where: { id, empresaId } });
    if (r.count === 0) throw new NotFoundException('Webhook', id);
  }

  /**
   * Receiver público: rate-limit → HMAC (tempo constante) → anti-replay →
   * idempotência → dispara WEBHOOK_RECEBIDO. Sempre 200 quando aceito/dedupado;
   * 401 uniforme quando inválido (não revela se o token existe).
   */
  async processar(input: ReceberWebhookInput): Promise<{ ok: boolean }> {
    const { token, rawBody, signature, idempotencyKey, timestamp } = input;

    if (!(await this.dentroDoLimite(token))) {
      throw new AppException(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        'Muitas requisições',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const wh = await this.prisma.webhookEntrada.findUnique({
      where: { token },
      select: { id: true, empresaId: true, nome: true, ativo: true, secret: true },
    });

    // HMAC SEMPRE (mesmo p/ token inexistente, contra secret dummy) → sem oráculo
    // de timing nem de existência de token.
    const secret = wh?.secret ?? DUMMY_SECRET;
    const rb = rawBody ?? Buffer.alloc(0);
    const assinaturaOk =
      !!signature && WebhookSignatureUtil.verifyHmacSha256(rb, signature, secret);

    if (!wh || !wh.ativo || !wh.secret || !assinaturaOk) {
      throw new UnauthorizedException('Webhook inválido', ErrorCode.AUTH_INVALID_TOKEN);
    }

    // Anti-replay por HMAC (+ timestamp opcional): mesmo POST reenviado → ACK sem processar.
    const { fresh } = await this.antiReplay.checkAndMarkWebhook('fluxo', signature, timestamp);
    if (!fresh) return { ok: true };

    // Idempotência forte (DB) quando o emissor manda Idempotency-Key — sobrevive a Redis frio.
    if (idempotencyKey) {
      try {
        await this.prisma.webhookRecebimento.create({
          data: { empresaId: wh.empresaId, webhookId: wh.id, idempotencyKey },
        });
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return { ok: true }; // já processado
        throw e;
      }
    }

    await this.bus.disparar(wh.empresaId, 'WEBHOOK_RECEBIDO', {
      webhookId: wh.id,
      webhookNome: wh.nome,
      payload: this.parsePayload(rb),
    });
    return { ok: true };
  }

  /** Rate-limit por token (janela de 1min) ANTES do lookup. Fail-open se Redis cair. */
  private async dentroDoLimite(token: string): Promise<boolean> {
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `webhook:fluxo:rl:${token}:${bucket}`;
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.client.expire(key, 90);
      return n <= RL_MAX_POR_MIN;
    } catch {
      return true;
    }
  }

  /** Corpo cru → objeto JSON pro contexto ({{payload.*}}). Falha vira {}. */
  private parsePayload(rawBody: Buffer): Record<string, unknown> {
    const txt = rawBody.toString('utf8').trim();
    if (!txt) return {};
    try {
      const parsed: unknown = JSON.parse(txt);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
