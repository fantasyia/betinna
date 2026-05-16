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
import { z } from 'zod';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { Public } from '@shared/decorators/public.decorator';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { WebhookSignatureUtil } from '@shared/http/webhook-signature.util';
import { WebhookAntiReplayService } from '@shared/utils/webhook-anti-replay.service';

const webhookClienteStatusSchema = z.object({
  codigo_cliente_omie: z.coerce.number().int().positive(),
  bloqueado: z.enum(['S', 'N']).optional(),
  inativo: z.enum(['S', 'N']).optional(),
});

/**
 * Receiver de webhooks do OMIE.
 *
 * O OMIE permite cadastrar webhooks por evento. Aqui tratamos:
 *  - Alteração de status do cliente (bloqueio/desbloqueio)
 *
 * Verificação de assinatura:
 *  - Header `X-Omie-Signature` (HMAC-SHA256 do body cru)
 *  - Secret configurado em OMIE_WEBHOOK_SECRET
 *
 * O endpoint é público (sem AuthGuard) mas validado por HMAC.
 * Resposta 200 imediata pra não retentar — erros são logados.
 */
@ApiTags('webhooks')
@Controller('webhooks/omie')
// Webhooks: 100 req/min por IP (proxy do OMIE) — limite alto pra picos de eventos
@Throttle({ default: { limit: 100, ttl: seconds(60) } })
export class OmieWebhookController {
  private readonly logger = new Logger(OmieWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly antiReplay: WebhookAntiReplayService,
  ) {}

  @Public()
  @Post('cliente-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recebe alterações de status de cliente do OMIE (bloqueado/desbloqueado)',
  })
  async clienteStatus(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-omie-signature') signature: string | undefined,
    @Headers('x-omie-timestamp') omieTimestamp: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    const secret = this.env.get('OMIE_WEBHOOK_SECRET');
    const isProd = this.env.isProduction;
    if (!secret) {
      if (isProd) {
        // Em produção, ausência do secret = endpoint não funcional.
        // Env schema bloqueia isso no boot, mas defesa em profundidade aqui.
        this.logger.error('OMIE_WEBHOOK_SECRET ausente em produção — webhook rejeitado');
        throw new UnauthorizedException('webhook secret não configurado');
      }
      this.logger.warn('OMIE_WEBHOOK_SECRET ausente (dev) — webhook aceito sem HMAC');
    } else {
      const rawBody = req.rawBody;
      if (!rawBody) {
        this.logger.warn('Webhook OMIE sem rawBody — não é possível validar HMAC');
        throw new UnauthorizedException('rawBody ausente');
      }
      if (!signature || !WebhookSignatureUtil.verifyHmacSha256(rawBody, signature, secret)) {
        this.logger.warn('Webhook OMIE com assinatura inválida — descartado');
        throw new UnauthorizedException('assinatura inválida');
      }

      // Sprint 3 FIX 1: anti-replay (timestamp window + signature dedup).
      // OMIE pode enviar `X-Omie-Timestamp` (opcional). Sem ele, fallback pra
      // dedup por signature dentro de 10min.
      const replay = await this.antiReplay.checkAndMarkWebhook(
        'omie',
        signature,
        omieTimestamp,
      );
      if (!replay.fresh) {
        // Já processado — ACK idempotente sem reprocessar
        return { ok: true };
      }
    }

    const parsed = webhookClienteStatusSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(
        `Payload de webhook OMIE inválido: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      );
      // Retorna 200 mesmo assim — não queremos OMIE retentando
      return { ok: false };
    }

    const codigoOmie = parsed.data.codigo_cliente_omie.toString();
    const novoOmieStatus = parsed.data.bloqueado === 'S' ? 'BLOQUEADO' : 'ATIVO';

    // codigoOmie agora é único dentro de cada empresa (@@unique [empresaId, codigoOmie]).
    // O webhook OMIE não inclui empresaId no payload, então usamos findFirst.
    // Em ambiente multi-tenant real, diferentes empresas OMIE têm suas próprias
    // sequências de código — colisão entre tenants é improvável, mas caso ocorra,
    // o primeiro match será atualizado. Evolução futura: endpoint por empresa
    // `/webhooks/omie/:empresaToken/cliente-status`.
    const cliente = await this.prisma.cliente.findFirst({
      where: { codigoOmie },
      select: { id: true, empresaId: true, omieStatus: true, nome: true },
    });
    if (!cliente) {
      this.logger.warn(
        `Webhook OMIE: cliente ${codigoOmie} não encontrado localmente — sync primeiro`,
      );
      return { ok: false };
    }

    if (cliente.omieStatus === novoOmieStatus) {
      return { ok: true }; // sem mudança, idempotente
    }

    await this.prisma.cliente.update({
      where: { id: cliente.id },
      data: { omieStatus: novoOmieStatus },
    });

    this.logger.log(
      `Cliente ${cliente.nome} (${codigoOmie}) → omieStatus=${novoOmieStatus} via webhook`,
    );
    return { ok: true };
  }
}
