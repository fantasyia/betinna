import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { PedidosMarketplaceService } from './pedidos-marketplace.service';

const listarSchema = z.object({
  plataforma: z.enum(['ML', 'SHOPEE', 'AMAZON', 'TIKTOK']).optional(),
  situacao: z
    .enum(['A_ENVIAR', 'ENVIADO', 'ENTREGUE', 'CANCELADO', 'EM_DEVOLUCAO', 'AGUARDANDO_PAGAMENTO'])
    .optional(),
  de: z.string().max(40).optional(),
  ate: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const vincularSchema = z.object({
  plataforma: z.enum(['ML', 'SHOPEE', 'AMAZON', 'TIKTOK']),
  sku: z.string().trim().min(1).max(120),
  variacaoId: z.string().min(1).max(40),
  quantidade: z.number().int().min(1).max(100),
});

/** Pedidos de venda dos marketplaces, 1 por 1, com lucro (Léo, 24/10). */
@ApiTags('pedidos-marketplace')
@ApiBearerAuth()
@Controller('marketplace/pedidos')
export class PedidosMarketplaceController {
  constructor(private readonly svc: PedidosMarketplaceService) {}

  @Get()
  @ApiOperation({
    summary: 'Pedidos dos marketplaces com bruto, taxas, frete, líquido, custo e lucro',
  })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarSchema)) q: z.infer<typeof listarSchema>,
  ) {
    return this.svc.listar(user, q);
  }

  @Get('skus-sem-custo')
  @ApiOperation({ summary: 'SKUs vendidos sem custo (kit ou SKU diferente do cadastro)' })
  skusSemCusto(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.skusSemCusto(user);
  }

  @Get('variacoes')
  @ApiOperation({ summary: 'Variações do cadastro pra ligar a um SKU do marketplace' })
  variacoes(@CurrentUser() user: AuthenticatedUser, @Query('busca') busca?: string) {
    return this.svc.variacoes(user, busca);
  }

  @Post('vincular')
  @ApiOperation({
    summary: 'Liga SKU do marketplace → variação (kit = quantidade) e recalcula os custos',
  })
  vincular(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(vincularSchema)) dto: z.infer<typeof vincularSchema>,
  ) {
    return this.svc.vincular(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Um pedido: itens, taxas, frete, líquido, custo e lucro' })
  detalhe(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.detalhe(user, id);
  }
}
