import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ShopeeFlashSaleService } from './shopee-flash-sale.service';

const id = z.coerce.number().int().positive();
const modelo = z
  .object({
    model_id: z.number().int().positive().optional(),
    preco: z.number().positive().max(100_000).optional(),
    desconto: z.number().gt(0).lt(100).optional(),
    estoque: z.number().int().min(1).max(100_000),
    status: z.union([z.literal(0), z.literal(1)]).optional(),
  })
  .refine((m) => (m.preco === undefined) !== (m.desconto === undefined), {
    message: 'Mande preco OU desconto (um dos dois)',
  });
const item = z.object({
  item_id: z.number().int().positive(),
  purchase_limit: z.number().int().min(0).max(1000).optional(),
  models: z.array(modelo).min(1).max(50),
});
const itensSchema = z.object({ itens: z.array(item).min(1).max(50) });
const criarSchema = z.object({ timeslot_id: z.number().int().positive() });
const statusSchema = z.object({ status: z.union([z.literal(1), z.literal(2)]) });
const listarSchema = z.object({
  type: z.coerce.number().int().min(0).max(3).default(0),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const horariosSchema = z.object({ start_time: id, end_time: id });
const precoSchema = z.object({
  models: z
    .array(
      z.object({
        model_id: z.number().int().min(0).optional(),
        preco: z.number().positive().max(100_000),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * Oferta Relâmpago da Shopee (Léo, 31/10). Escopo de token `shopee-promocoes`.
 * Criar, pôr item e ativar mexem na loja de verdade — só com o OK do Léo.
 */
@ApiTags('shopee-promocoes')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('shopee-promocoes')
export class ShopeeFlashSaleController {
  constructor(private readonly svc: ShopeeFlashSaleService) {}

  @Get('flash-sale')
  @ApiOperation({
    summary: 'Ofertas relâmpago (type 0 todas, 1 próximas, 2 em andamento, 3 encerradas)',
  })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarSchema)) q: z.infer<typeof listarSchema>,
  ) {
    return this.svc.listar(user, q.type, q.offset, q.limit);
  }

  @Get('flash-sale/horarios')
  @ApiOperation({ summary: 'Horários (timeslot) entre start_time e end_time (Unix, segundos)' })
  horarios(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(horariosSchema)) q: z.infer<typeof horariosSchema>,
  ) {
    return this.svc.horarios(user, q.start_time, q.end_time);
  }

  @Get('flash-sale/:id')
  @ApiOperation({ summary: 'Uma oferta com os itens' })
  ver(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) fsId: number) {
    return this.svc.ver(user, fsId);
  }

  @Post('flash-sale')
  @ApiOperation({ summary: 'Cria a oferta num timeslot (nasce sem itens)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(criarSchema)) dto: z.infer<typeof criarSchema>,
  ) {
    return this.svc.criar(user, dto.timeslot_id);
  }

  @Post('flash-sale/:id/itens')
  @ApiOperation({ summary: 'Põe itens na oferta (preço final ou desconto %, estoque, limite)' })
  adicionar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) fsId: number,
    @Body(new ZodValidationPipe(itensSchema)) dto: z.infer<typeof itensSchema>,
  ) {
    return this.svc.adicionarItens(user, fsId, dto.itens);
  }

  @Post('flash-sale/:id/itens/editar')
  @ApiOperation({ summary: 'Edita itens da oferta (preço, estoque, limite, status 1/0)' })
  editar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) fsId: number,
    @Body(new ZodValidationPipe(itensSchema)) dto: z.infer<typeof itensSchema>,
  ) {
    return this.svc.editarItens(user, fsId, dto.itens);
  }

  @Post('flash-sale/:id/status')
  @ApiOperation({ summary: 'Ativa (1) ou desativa (2) a oferta' })
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) fsId: number,
    @Body(new ZodValidationPipe(statusSchema)) dto: z.infer<typeof statusSchema>,
  ) {
    return this.svc.status(user, fsId, dto.status);
  }

  @Post('anuncios/:itemId/preco')
  @ApiOperation({ summary: 'Muda o preço do anúncio por model (sem variação = model_id 0)' })
  preco(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(precoSchema)) dto: z.infer<typeof precoSchema>,
  ) {
    return this.svc.atualizarPreco(user, itemId, dto.models);
  }

  @Get('anuncios/:itemId/modelos')
  @ApiOperation({ summary: 'Preço e estoque atuais de cada model, com vendedor e Full separados' })
  modelos(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.svc.modelos(user, itemId);
  }
}
