import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type PrecosLinhaDto,
  type TaxasPrecificacaoDto,
  precosLinhaSchema,
  taxasPrecificacaoSchema,
} from './precificacao.dto';
import { PrecificacaoService } from './precificacao.service';

/**
 * Calculadora de precificação — só ADMIN/DIRECTOR (custo é dado sensível) e
 * só em empresa com a calculadora ligada (o service recusa com 422).
 */
@ApiTags('precificacao')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('precificacao')
export class PrecificacaoController {
  constructor(private readonly svc: PrecificacaoService) {}

  @Get('status')
  @ApiOperation({ summary: 'A calculadora está ligada nesta empresa?' })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.status(user);
  }

  @Get()
  @ApiOperation({ summary: 'Taxas da empresa, faixas, pedido mínimo e custo/preço por linha' })
  carregar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.carregar(user);
  }

  @Put('taxas')
  @ApiOperation({ summary: 'Salva imposto, taxas, anúncio e embalagem da empresa' })
  salvarTaxas(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(taxasPrecificacaoSchema)) dto: TaxasPrecificacaoDto,
  ) {
    return this.svc.salvarTaxas(user, dto);
  }

  @Put('linhas/:id')
  @ApiOperation({ summary: 'Salva custo, preços por faixa e revenda sugerida na Linha do modelo' })
  salvarLinha(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(precosLinhaSchema)) dto: PrecosLinhaDto,
  ) {
    return this.svc.salvarPrecosDaLinha(user, id, dto);
  }
}
