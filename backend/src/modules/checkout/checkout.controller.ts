import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { IntegrationException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CheckoutPublicoService } from './checkout-publico.service';
import { CheckoutService } from './checkout.service';

/** Pagamento online da vitrine — ligar/desligar a conta Asaas da empresa. */
@ApiTags('checkout')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly svc: CheckoutService) {}

  @Get('status')
  @ApiOperation({ summary: 'Conta Asaas conectada? Pagamento online ativo? Taxas lidas.' })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.status(user);
  }

  @Post('ativar')
  @ApiOperation({
    summary: 'Confere a chave, lê as taxas e cadastra o aviso de pagamento no Asaas',
  })
  ativar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.ativar(user);
  }

  @Put('juros')
  @ApiOperation({
    summary: 'Juros do parcelado no cartão (% ao mês, simples), além da taxa do Asaas',
  })
  juros(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(z.object({ jurosMesPct: z.number().min(0).max(10) })))
    dto: { jurosMesPct: number },
  ) {
    return this.svc.salvarJuros(user, dto.jurosMesPct);
  }

  @Post('desativar')
  @ApiOperation({ summary: 'Desliga o pagamento online na vitrine' })
  desativar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.desativar(user);
  }
}

/**
 * Aviso de pagamento do Asaas (webhook), por empresa. Autenticado pelo código
 * secreto que o Asaas devolve no cabeçalho `asaas-access-token` (cadastrado no
 * "Ativar"). Grava e responde 200 — o Asaas pausa a fila depois de 15 falhas
 * seguidas, então resposta lenta ou erro aqui custa caro.
 */
@ApiTags('webhooks')
@Controller('webhooks/asaas')
export class AsaasWebhookController {
  constructor(
    private readonly svc: CheckoutService,
    private readonly publico: CheckoutPublicoService,
  ) {}

  @Post(':empresaId')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 300, ttl: seconds(60) } })
  @ApiOperation({ summary: 'Recebe os avisos de cobrança do Asaas (código no cabeçalho)' })
  async receber(
    @Param('empresaId') empresaId: string,
    @Headers('asaas-access-token') token: string | undefined,
    @Body() corpo: unknown,
  ): Promise<{ ok: true }> {
    try {
      const { novo } = await this.svc.registrarAviso(empresaId, token, corpo);
      // ACK primeiro; o pedido vira PAGO logo em seguida (e o job refaz se falhar).
      const id = (corpo as { id?: unknown })?.id;
      if (novo && typeof id === 'string') void this.publico.processar(id).catch(() => undefined);
    } catch (err) {
      if (err instanceof IntegrationException && err.code === ErrorCode.AUTH_INVALID_TOKEN) {
        throw new UnauthorizedException('Código inválido', ErrorCode.AUTH_INVALID_TOKEN);
      }
      throw err;
    }
    return { ok: true };
  }
}
