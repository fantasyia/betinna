import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type ListIncidentsDto, listIncidentsSchema } from './incidents.dto';
import { IncidentsService } from './incidents.service';

/**
 * Incidentes de marketplace (reclamações/devoluções/disputas/mediações).
 * Restrito a SAC/gerência. REP não acessa.
 */
@ApiTags('incidents')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'SAC')
@Controller('marketplace/incidentes')
export class IncidentsController {
  constructor(private readonly svc: IncidentsService) {}

  @Get('resumo')
  @ApiOperation({ summary: 'Resumo de incidentes (aguardando, prazo urgente, em mediação)' })
  resumo(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.resumo(user);
  }

  @Get()
  @ApiOperation({
    summary:
      'Lista incidentes (filtros: canal, tipo, status, clienteId, aguardandoMim, prazoUrgente)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listIncidentsSchema)) query: ListIncidentsDto,
  ) {
    return this.svc.list(user, query);
  }

  @Get(':id')
  findById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.findById(user, id);
  }
}
