import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { VariavelCustomizadaService } from './variavel-customizada.service';

const upsertVariavelSchema = z.object({
  chave: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z0-9_]+$/, 'Use apenas letras, números e _ (ex: pedido_minimo_kg)'),
  descricao: z.string().max(200).optional(),
  valorPadrao: z.string().max(500).optional(),
});
type UpsertVariavelDto = z.infer<typeof upsertVariavelSchema>;

@ApiTags('orquestracao')
@ApiBearerAuth()
@Controller('orquestracao/variaveis')
@Roles('ADMIN', 'DIRECTOR')
export class VariavelCustomizadaController {
  constructor(private readonly svc: VariavelCustomizadaService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as variáveis customizadas da empresa ({{custom.*}})' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user);
  }

  @Post()
  @Audit({ action: 'upsert', resource: 'variavel_custom' })
  @ApiOperation({ summary: 'Cria/atualiza uma variável customizada (por chave)' })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(upsertVariavelSchema)) dto: UpsertVariavelDto,
  ) {
    return this.svc.upsert(user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'variavel_custom', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user, id);
  }
}
