import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateDevolucaoDto,
  type ListDevolucoesDto,
  type MudarStatusDevolucaoDto,
  createDevolucaoSchema,
  listDevolucoesSchema,
  mudarStatusDevolucaoSchema,
} from './devolucoes.dto';
import { DevolucoesService } from './devolucoes.service';

@ApiTags('devolucoes')
@ApiBearerAuth()
@Controller('devolucoes')
export class DevolucoesController {
  constructor(private readonly devolucoes: DevolucoesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listDevolucoesSchema)) query: ListDevolucoesDto,
  ) {
    return this.devolucoes.list(user, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.devolucoes.findById(user, id);
  }

  @Post()
  @Audit({ action: 'abrir', resource: 'devolucao', resourceIdFrom: 'response.id' })
  @ApiOperation({ summary: 'Abre uma devolução de um pedido (rep+)' })
  abrir(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDevolucaoSchema)) dto: CreateDevolucaoDto,
  ) {
    return this.devolucoes.abrir(user, dto);
  }

  @Put(':id/status')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'mudar_status', resource: 'devolucao', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Avança o lifecycle da devolução (diretoria)' })
  mudarStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(mudarStatusDevolucaoSchema)) dto: MudarStatusDevolucaoDto,
  ) {
    return this.devolucoes.mudarStatus(user, id, dto);
  }
}
