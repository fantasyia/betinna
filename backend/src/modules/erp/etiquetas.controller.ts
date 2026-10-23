import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { etiquetasSchema, type EtiquetasDto } from './etiquetas.dto';
import { EtiquetasService } from './etiquetas.service';

/** Etiqueta de código de barras das peças (Léo, 20/10). ERP ligado. */
@ApiTags('erp')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR', 'GERENTE')
@Controller('erp/etiquetas')
export class EtiquetasController {
  constructor(private readonly svc: EtiquetasService) {}

  @Get('pecas')
  @ApiOperation({ summary: 'Peças unitárias (modelo, cor, linha, tamanho, SKU, EAN) pra escolher' })
  pecas(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.pecas(user);
  }

  @Post()
  @ApiOperation({
    summary: 'PDF das etiquetas (40×80 1 coluna ou 50×30 2 colunas), em base64',
  })
  gerar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(etiquetasSchema)) dto: EtiquetasDto,
  ) {
    return this.svc.gerar(user, dto);
  }
}
