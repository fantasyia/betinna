import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '@shared/decorators/public.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { CheckoutPublicoService } from './checkout-publico.service';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{3,40}$/);
const idSchema = z.string().trim().min(10).max(40);
const tokenSchema = z.string().trim().min(10).max(80);

const iniciarSchema = z.object({
  token: tokenSchema,
  metodo: z.enum(['PIX', 'CARTAO']),
  parcelas: z.number().int().min(1).max(12).optional(),
  cpfCnpj: z.string().trim().min(11).max(20),
  email: z.string().trim().email().max(120).nullable().optional(),
});
type IniciarDto = z.infer<typeof iniciarSchema>;

/**
 * Pagamento do pedido pela VITRINE (público): só abre com o código do pedido
 * (que só quem enviou o pedido recebe). Pix = QR na tela; cartão = página
 * segura do Asaas (o cartão nunca passa por aqui).
 */
@ApiTags('vitrine')
@Controller('public/vitrine/:slug/pedidos/:pedidoId/pagamento')
export class CheckoutPublicoController {
  constructor(private readonly svc: CheckoutPublicoService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: seconds(60) } })
  @Get()
  @ApiOperation({
    summary: 'Opções de pagamento do pedido (Pix e cartão 1–12x) + cobrança em aberto',
  })
  opcoes(
    @Param('slug', new ZodValidationPipe(slugSchema)) slug: string,
    @Param('pedidoId', new ZodValidationPipe(idSchema)) pedidoId: string,
    @Query('t') token?: string,
  ) {
    return this.svc.opcoes(slug, pedidoId, token);
  }

  @Public()
  // Quem está com o QR na tela pergunta a cada poucos segundos.
  @Throttle({ default: { limit: 40, ttl: seconds(60) } })
  @Get('status')
  @ApiOperation({ summary: 'O pedido já foi pago?' })
  status(
    @Param('slug', new ZodValidationPipe(slugSchema)) slug: string,
    @Param('pedidoId', new ZodValidationPipe(idSchema)) pedidoId: string,
    @Query('t') token?: string,
  ) {
    return this.svc.status(slug, pedidoId, token);
  }

  @Public()
  // Gera cobrança no Asaas: teto apertado contra robô e clique repetido.
  @Throttle({ default: { limit: 10, ttl: seconds(600) } })
  @Post()
  @ApiOperation({ summary: 'Gera a cobrança (Pix ou cartão) do pedido no Asaas' })
  iniciar(
    @Param('slug', new ZodValidationPipe(slugSchema)) slug: string,
    @Param('pedidoId', new ZodValidationPipe(idSchema)) pedidoId: string,
    @Body(new ZodValidationPipe(iniciarSchema)) dto: IniciarDto,
  ) {
    return this.svc.iniciar(slug, pedidoId, dto);
  }
}
