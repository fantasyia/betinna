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
import {
  type ChangeAmostraStatusDto,
  type CreateAmostraDto,
  type ListAmostrasDto,
  type RejeitarAmostraDto,
  type UpdateAmostraDto,
  changeAmostraStatusSchema,
  createAmostraSchema,
  listAmostrasSchema,
  rejeitarAmostraSchema,
  updateAmostraSchema,
} from './amostras.dto';
import { AmostrasService } from './amostras.service';

@ApiTags('amostras')
@ApiBearerAuth()
@Controller('amostras')
export class AmostrasController {
  constructor(private readonly amostras: AmostrasService) {}

  @Get()
  @RequirePermissions({ module: 'amostras', action: 'view' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listAmostrasSchema)) query: ListAmostrasDto,
  ) {
    return this.amostras.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'amostras', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.amostras.findById(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'amostras', action: 'create' })
  @Audit({ action: 'create', resource: 'amostra', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAmostraSchema)) dto: CreateAmostraDto,
  ) {
    return this.amostras.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'amostras', action: 'edit' })
  @Audit({ action: 'update', resource: 'amostra', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAmostraSchema)) dto: UpdateAmostraDto,
  ) {
    return this.amostras.update(user, id, dto);
  }

  @Put(':id/status')
  @RequirePermissions({ module: 'amostras', action: 'edit' })
  @Audit({ action: 'change_status', resource: 'amostra', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Atualiza status (ex: ENVIADA → CONVERTIDA)' })
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeAmostraStatusSchema)) dto: ChangeAmostraStatusDto,
  ) {
    return this.amostras.changeStatus(user, id, dto);
  }

  @Post(':id/aprovar')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'aprovar', resource: 'amostra', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Aprova amostra subsidiada na fila (PENDENTE_APROVACAO → ENVIADA)' })
  aprovar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.amostras.aprovar(user, id);
  }

  @Post(':id/rejeitar')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'rejeitar', resource: 'amostra', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Rejeita amostra subsidiada na fila (PENDENTE_APROVACAO → REJEITADA)' })
  rejeitar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejeitarAmostraSchema)) dto: RejeitarAmostraDto,
  ) {
    return this.amostras.rejeitar(user, id, dto);
  }

  @Post(':id/enviar-omie')
  @RequirePermissions({ module: 'amostras', action: 'edit' })
  @Audit({ action: 'enviar_omie', resource: 'amostra', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'P7 — Envia a amostra como remessa de amostra grátis ao OMIE (CFOP 5911/6911, sem destaque de tributos).',
  })
  enviarOmie(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.amostras.enviarParaOmie(user, id);
  }

  @Delete(':id')
  // Blindagem: gate granular colapsa edit→delete (REP teria delete). @Roles tranca em gestão.
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @RequirePermissions({ module: 'amostras', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'amostra', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.amostras.remove(user, id);
  }
}
