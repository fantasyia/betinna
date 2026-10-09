import { Body, Controller, Get, Header, Headers, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '@shared/decorators/public.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { VitrinePublicaService } from './vitrine-publica.service';
import { VitrinePedidoService } from './vitrine-pedido.service';
import { FreteService } from './frete.service';
import { PrivacidadeService } from './privacidade.service';
import { type PedidoVitrineDto, cotarFreteSchema, pedidoVitrineSchema } from './vitrine.dto';

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
    private readonly frete: FreteService,
    private readonly privacidade: PrivacidadeService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: seconds(60) } })
  @Header('Cache-Control', 'public, max-age=300')
  @Get(':slug/privacidade')
  @ApiOperation({
    summary: 'Política de Privacidade da vitrine (texto conforme o que a empresa usa)',
  })
  politica(@Param('slug', new ZodValidationPipe(slugSchema)) slug: string) {
    return this.privacidade.publica(slug);
  }

  @Public()
  // Endereço do CEP (ViaCEP pelo servidor: a tela não fala com terceiros).
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  @Get('cep/:cep')
  @ApiOperation({ summary: 'Rua, bairro, cidade e UF do CEP (null = não achou)' })
  cep(@Param('cep') cep: string) {
    return this.frete.buscarCep(cep);
  }

  @Public()
  // Cada cotação vira chamadas ao Melhor Envio: teto por IP.
  @Throttle({ default: { limit: 20, ttl: seconds(60) } })
  @Post(':slug/frete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cota o frete do carrinho pro CEP (volumes, opções e retirada)' })
  cotarFrete(
    @Param('slug', new ZodValidationPipe(slugSchema)) slug: string,
    @Body(new ZodValidationPipe(cotarFreteSchema))
    dto: { cep: string; itens: PedidoVitrineDto['itens'] },
  ) {
    return this.pedidos.cotarFrete(slug, dto);
  }

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
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    // IP e navegador: a API de Conversões do Meta exige pra evento de site.
    return this.pedidos.enviar(slug, dto, { ip, userAgent });
  }
}
