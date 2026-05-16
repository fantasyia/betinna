import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type DecidirAprovacaoDto,
  type ListAprovacoesDto,
  decidirAprovacaoSchema,
  listAprovacoesSchema,
} from './aprovacoes.dto';
import { AprovacoesService } from './aprovacoes.service';

@ApiTags('aprovacoes')
@ApiBearerAuth()
@Controller('aprovacoes')
export class AprovacoesController {
  constructor(private readonly aprovacoes: AprovacoesService) {}

  @Get()
  @RequirePermissions({ module: 'aprovacoes', action: 'view' })
  @ApiOperation({ summary: 'Lista aprovações (rep vê só as próprias)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listAprovacoesSchema)) query: ListAprovacoesDto,
  ) {
    return this.aprovacoes.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'aprovacoes', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.aprovacoes.findById(user, id);
  }

  @Post(':id/aprovar')
  @RequirePermissions({ module: 'aprovacoes', action: 'approve' })
  @Audit({ action: 'aprovar', resource: 'aprovacao', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Aprova desconto. Pedido volta pra RASCUNHO.' })
  aprovar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decidirAprovacaoSchema)) dto: DecidirAprovacaoDto,
  ) {
    return this.aprovacoes.aprovar(user, id, dto);
  }

  @Post(':id/rejeitar')
  @RequirePermissions({ module: 'aprovacoes', action: 'approve' })
  @Audit({ action: 'rejeitar', resource: 'aprovacao', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Rejeita desconto. Pedido vai pra CANCELADO.' })
  rejeitar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decidirAprovacaoSchema)) dto: DecidirAprovacaoDto,
  ) {
    return this.aprovacoes.rejeitar(user, id, dto);
  }
}
