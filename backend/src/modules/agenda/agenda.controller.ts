import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateAgendaItemDto,
  type ListAgendaDto,
  type UpdateAgendaItemDto,
  createAgendaItemSchema,
  listAgendaSchema,
  updateAgendaItemSchema,
} from './agenda.dto';
import { AgendaService } from './agenda.service';

@ApiTags('agenda')
@ApiBearerAuth()
@Controller('agenda')
export class AgendaController {
  constructor(private readonly svc: AgendaService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista itens da agenda (filtros: inicio, fim, clienteId, tipo, usuarioId)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listAgendaSchema)) query: ListAgendaDto,
  ) {
    return this.svc.list(user, query);
  }

  @Get(':id')
  findById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.findById(user, id);
  }

  @Post()
  @Audit({ action: 'create', resource: 'agenda', resourceIdFrom: 'response.id' })
  @ApiOperation({
    summary: 'Cria item da agenda (espelha no Google Calendar se conectado)',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAgendaItemSchema)) dto: CreateAgendaItemDto,
  ) {
    return this.svc.create(user, dto);
  }

  @Patch(':id')
  @Audit({ action: 'update', resource: 'agenda', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAgendaItemSchema)) dto: UpdateAgendaItemDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'delete', resource: 'agenda', resourceIdFrom: 'params.id' })
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.delete(user, id);
  }
}
