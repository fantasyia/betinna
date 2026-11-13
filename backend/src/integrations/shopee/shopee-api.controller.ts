import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CAMINHO_SHOPEE, ShopeeApiService } from './shopee-api.service';

const valor = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(200), z.number()])).max(100),
]);
const lerSchema = z.object({
  caminho: z.string().regex(CAMINHO_SHOPEE),
  query: z.record(z.string(), valor).optional(),
});
const escreverSchema = lerSchema.extend({
  corpo: z.record(z.string(), z.unknown()).optional(),
});

/**
 * API da Shopee crua (13/11). Escopo de token `shopee-promocoes`. Ler é livre;
 * escrever mexe na loja — travas de estoque e Full no serviço.
 */
@ApiTags('shopee-promocoes')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('shopee-promocoes/api')
export class ShopeeApiController {
  constructor(private readonly svc: ShopeeApiService) {}

  @Post('ler')
  @ApiOperation({ summary: 'GET em qualquer rota /api/v2 da Shopee, resposta crua' })
  ler(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(lerSchema)) dto: z.infer<typeof lerSchema>,
  ) {
    return this.svc.ler(user, dto.caminho, dto.query);
  }

  @Post('escrever')
  @Audit({ action: 'ESCREVER', resource: 'shopee_api' })
  @ApiOperation({
    summary: 'POST em rota /api/v2 da Shopee, sem estoque e sem Full — MEXE NA LOJA',
  })
  escrever(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(escreverSchema)) dto: z.infer<typeof escreverSchema>,
  ) {
    return this.svc.escrever(user, dto.caminho, dto.corpo, dto.query);
  }
}
