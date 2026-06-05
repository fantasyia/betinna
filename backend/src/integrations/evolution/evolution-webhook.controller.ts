import { Body, Controller, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@shared/decorators/public.decorator';
import { EnvService } from '@config/env.service';
import { EvolutionService } from './evolution.service';
import { EvolutionInboundService } from './evolution-inbound.service';

/**
 * Recebe os eventos do Evolution API (mensagens, conexão, QR). Endpoint @Public,
 * protegido por um token derivado da EVOLUTION_API_KEY na URL (não expõe a key
 * crua). A URL configurada na instância do Evolution é:
 *   {API_URL}/webhooks/evolution/{token}
 */
@ApiExcludeController()
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  constructor(
    private readonly env: EnvService,
    private readonly inbound: EvolutionInboundService,
  ) {}

  @Public()
  @Post(':token')
  receber(
    @Param('token') token: string,
    @Body() body: { event?: string; instance?: string; data?: unknown },
  ): { ok: true } {
    const esperado = EvolutionService.webhookToken(this.env.get('EVOLUTION_API_KEY') || '');
    if (!esperado || token !== esperado) {
      throw new UnauthorizedException('webhook token inválido');
    }
    // Responde 200 na hora (pro Evolution não re-tentar) e processa em background.
    void this.inbound.processarEvento(body);
    return { ok: true };
  }
}
