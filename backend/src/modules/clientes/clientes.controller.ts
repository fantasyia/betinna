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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ClientesService } from './clientes.service';
import {
  type AssignRepDto,
  type BulkAssignRepDto,
  type CreateClienteDto,
  type ListClientesDto,
  type SetTagsDto,
  type UpdateClienteDto,
  type UpdateOmieStatusDto,
  assignRepSchema,
  bulkAssignRepSchema,
  createClienteSchema,
  listClientesSchema,
  setTagsSchema,
  updateClienteSchema,
  updateOmieStatusSchema,
} from './clientes.dto';
import { ListasDinamicasService } from './listas-dinamicas.service';

@ApiTags('clientes')
@ApiBearerAuth()
@Controller('clientes')
export class ClientesController {
  constructor(
    private readonly clientes: ClientesService,
    private readonly listas: ListasDinamicasService,
  ) {}

  @Get('listas')
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({ summary: 'Catálogo de listas dinâmicas disponíveis' })
  listasDisponiveis() {
    return this.listas.definicoes.map(({ where, ...meta }) => meta);
  }

  @Get()
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({
    summary: 'Lista clientes com filtros, paginação e listas dinâmicas',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listClientesSchema)) query: ListClientesDto,
  ) {
    return this.clientes.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'clientes', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.clientes.findById(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'clientes', action: 'create' })
  @Audit({ action: 'create', resource: 'cliente', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createClienteSchema)) dto: CreateClienteDto,
  ) {
    return this.clientes.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'update', resource: 'cliente', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateClienteSchema)) dto: UpdateClienteDto,
  ) {
    return this.clientes.update(user, id, dto);
  }

  @Put(':id/representante')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'assign_rep', resource: 'cliente', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Atribui (ou remove) representante do cliente — apenas ADMIN/DIRECTOR/GERENTE',
  })
  assignRep(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignRepSchema)) dto: AssignRepDto,
  ) {
    return this.clientes.assignRep(user, id, dto);
  }

  @Post('atribuir-rep-massa')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'bulk_assign_rep', resource: 'cliente' })
  @ApiOperation({
    summary:
      'Atribui representante a vários clientes de uma vez — apenas ADMIN/DIRECTOR/GERENTE. ' +
      'GERENTE só pode reatribuir clientes cujo rep atual está sob sua gerência.',
  })
  bulkAssignRep(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(bulkAssignRepSchema)) dto: BulkAssignRepDto,
  ) {
    return this.clientes.bulkAssignRep(user, dto);
  }

  @Put(':id/tags')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'set_tags', resource: 'cliente', resourceIdFrom: 'params.id' })
  setTags(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setTagsSchema)) dto: SetTagsDto,
  ) {
    return this.clientes.setTags(user, id, dto);
  }

  @Put(':id/omie-status')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'update_omie_status', resource: 'cliente', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Atualiza status do cliente no OMIE (ATIVO/BLOQUEADO)',
  })
  updateOmieStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOmieStatusSchema)) dto: UpdateOmieStatusDto,
  ) {
    return this.clientes.updateOmieStatus(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'clientes', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'cliente', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.clientes.remove(user, id);
  }
}
