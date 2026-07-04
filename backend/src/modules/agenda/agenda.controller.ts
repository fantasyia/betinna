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
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateAgendaItemDto,
  type ListAgendaDto,
  type UpdateAgendaItemDto,
  type GoogleEventosQuery,
  createAgendaItemSchema,
  listAgendaSchema,
  updateAgendaItemSchema,
  googleEventosSchema,
} from './agenda.dto';
import { AgendaService } from './agenda.service';

@ApiTags('agenda')
@ApiBearerAuth()
// P0 — gate server-side de permissão: tirar "Ver" da agenda de um usuário no
// painel passa a bloquear a API (antes só sumia do menu, mas a API respondia).
// Leitura exige agenda.view (classe); escrita exige também agenda.edit (método).
@RequirePermissions({ module: 'agenda', action: 'view' })
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

  @Get('google-eventos')
  @RequirePermissions({ module: 'agenda', action: 'view' })
  @ApiOperation({
    summary: 'Overlay read-only: eventos do Google Calendar do usuário numa faixa de datas',
  })
  listarGoogleEventos(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(googleEventosSchema)) query: GoogleEventosQuery,
  ) {
    return this.svc.listarGoogleEventos(user, query.inicio, query.fim);
  }

  @Post('sincronizar-google')
  @RequirePermissions({ module: 'agenda', action: 'view' }, { module: 'agenda', action: 'edit' })
  @Audit({ action: 'sincronizar_google', resource: 'agenda' })
  @ApiOperation({
    summary: 'Espelha no Google os compromissos futuros ainda não sincronizados (backfill)',
  })
  sincronizarGoogle(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.sincronizarGoogle(user);
  }

  @Post()
  @RequirePermissions({ module: 'agenda', action: 'view' }, { module: 'agenda', action: 'create' })
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
  @RequirePermissions({ module: 'agenda', action: 'view' }, { module: 'agenda', action: 'edit' })
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
  // 'edit' (não 'delete'): o SAC tem agenda edit mas não delete no default —
  // exigir 'delete' regrediria (hoje sem gate). Item de agenda é pessoal.
  @RequirePermissions({ module: 'agenda', action: 'view' }, { module: 'agenda', action: 'edit' })
  @Audit({ action: 'delete', resource: 'agenda', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Remove item da agenda. Para séries recorrentes use ?scope=this|this_and_future|series (default: this).',
  })
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('scope') scope?: string,
  ) {
    const validScope = ['this', 'this_and_future', 'series'].includes(scope ?? '')
      ? (scope as 'this' | 'this_and_future' | 'series')
      : 'this';
    return this.svc.delete(user, id, validScope);
  }
}
