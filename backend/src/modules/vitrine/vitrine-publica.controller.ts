import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '@shared/decorators/public.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { VitrinePublicaService } from './vitrine-publica.service';
import { VitrinePedidoService } from './vitrine-pedido.service';
import { type PedidoVitrineDto, pedidoVitrineSchema } from './vitrine.dto';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{3,40}$/);

/** Vitrine pública de atacado — o link que o cliente abre no celular. */
@ApiTags('vitrine')
@Controller('public/vitrine')
export class VitrinePublicaController {
  constructor(
    private readonly svc: VitrinePublicaService,
    private readonly pedidos: VitrinePedidoService,
  ) {}

  @Public()
  // Aberto na internet: teto por IP. 60/min cobre um cliente navegando à vontade.
  @Throttle({ default: { limit: 60, ttl: seconds(60) } })
  // Cache curto no navegador/CDN: o feed não precisa refletir o cadastro no segundo.
  @Header('Cache-Control', 'public, max-age=60')
  @Get(':slug')
  @ApiOperation({ summary: 'Catálogo publicado da vitrine (só o que pode aparecer)' })
  carregar(@Param('slug', new ZodValidationPipe(slugSchema)) slug: string) {
    return this.svc.carregar(slug);
  }

  @Public()
  // Envio de pedido: gente manda um ou dois; teto apertado contra robô.
  @Throttle({ default: { limit: 5, ttl: seconds(600) } })
  @Post(':slug/pedido')
  @HttpCode(201)
  @ApiOperation({ summary: 'Cliente envia o pedido da vitrine (preço recalculado no servidor)' })
  enviarPedido(
    @Param('slug', new ZodValidationPipe(slugSchema)) slug: string,
    @Body(new ZodValidationPipe(pedidoVitrineSchema)) dto: PedidoVitrineDto,
  ) {
    return this.pedidos.enviar(slug, dto);
  }
}
