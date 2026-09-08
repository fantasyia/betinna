import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@shared/decorators/public.decorator';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { EmailInboundService } from './email-inbound.service';

/**
 * Entrada de e-mail — a resposta do lead virando evento.
 *
 * Agnóstico de provedor de propósito: quem entrega (inbound do Resend,
 * Cloudflare Email Routing, um encaminhador) é escolha de infraestrutura, e
 * trocar essa escolha não pode virar mudança de código. O contrato é um POST
 * com o segredo no cabeçalho e o e-mail no corpo.
 *
 * Responde **200 mesmo quando ignora** (endereço que não é de tenant nenhum,
 * mensagem vazia): provedor que recebe erro reentrega pra sempre um e-mail que
 * a gente conscientemente descartou.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class EmailInboundController {
  private readonly logger = new Logger(EmailInboundController.name);

  constructor(private readonly svc: EmailInboundService) {}

  @Public()
  @Post('email-entrada')
  @HttpCode(HttpStatus.OK)
  // Caixa de e-mail tem rajada (uma régua que sai pra base inteira volta em
  // lote), mas 300/min já é muito acima do real e segura abuso.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Recebe uma resposta de e-mail e registra na Inbox (dispara LEAD_RESPONDEU). ' +
      'Exige o cabeçalho x-inbound-secret — sem EMAIL_INBOUND_SECRET configurado, recusa tudo.',
  })
  async receber(
    @Headers('x-inbound-secret') segredo: string | undefined,
    @Body() corpo: Record<string, unknown>,
  ): Promise<{ ok: true; efeito: string }> {
    if (!this.svc.segredoConfere(segredo)) {
      // Aceitar sem verificar deixaria qualquer um forjar "resposta" de um lead
      // — e resposta forjada PARA régua e cria tarefa pro representante.
      throw new UnauthorizedException('Segredo de entrada inválido');
    }
    const r = await this.svc.registrar(corpo ?? {});
    if (r.efeito !== 'registrado') {
      this.logger.log(`E-mail de entrada ignorado (${r.efeito})`);
    }
    return { ok: true, efeito: r.efeito };
  }
}
