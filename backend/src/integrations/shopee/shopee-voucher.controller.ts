import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ShopeeVoucherService } from './shopee-voucher.service';

const unix = z.number().int().positive();
const cupom = z.object({
  nome: z.string().trim().min(1).max(100),
  codigo: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{1,5}$/, 'Código: 1 a 5 letras maiúsculas ou números'),
  inicio: unix,
  fim: unix,
  alcance: z.enum(['loja', 'produtos']),
  itemIds: z.array(z.number().int().positive()).max(200).optional(),
  tipo: z.enum(['valor', 'percentual']),
  valor: z.number().positive().max(100_000).optional(),
  percentual: z.number().int().min(1).max(99).optional(),
  teto: z.number().positive().max(100_000).optional(),
  minimoCompra: z.number().min(0).max(100_000),
  quantidade: z.number().int().min(1).max(200_000),
  vitrine: z.boolean().optional(),
});
const listarSchema = z.object({
  status: z.enum(['upcoming', 'ongoing', 'expired', 'all']).default('all'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Cupons da loja Shopee (Léo, 31/10). Escopo de token `shopee-promocoes`.
 * Criar, editar, encerrar e apagar mexem na loja — só com o OK do Léo.
 */
@ApiTags('shopee-promocoes')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('shopee-promocoes/cupons')
export class ShopeeVoucherController {
  constructor(private readonly svc: ShopeeVoucherService) {}

  @Get()
  @ApiOperation({ summary: 'Cupons (upcoming, ongoing, expired, all)' })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarSchema)) q: z.infer<typeof listarSchema>,
  ) {
    return this.svc.listar(user, q.status, q.pagina, q.porPagina);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Um cupom' })
  ver(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.ver(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria cupom (valor fixo ou %, loja toda ou produtos)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(cupom)) dto: z.infer<typeof cupom>,
  ) {
    return this.svc.criar(user, dto);
  }

  @Post(':id/editar')
  @ApiOperation({ summary: 'Edita cupom (só os campos mandados)' })
  editar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(cupom.partial())) dto: Partial<z.infer<typeof cupom>>,
  ) {
    return this.svc.editar(user, id, dto);
  }

  @Post(':id/encerrar')
  @ApiOperation({ summary: 'Encerra cupom em andamento' })
  encerrar(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.encerrar(user, id);
  }

  @Post(':id/apagar')
  @ApiOperation({ summary: 'Apaga cupom que ainda não começou' })
  apagar(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.apagar(user, id);
  }
}
