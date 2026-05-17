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
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  ajustarSchema,
  createRecompensaSchema,
  listMovimentosSchema,
  resgatarSchema,
  updateProgramaSchema,
  updateRecompensaSchema,
  type AjustarDto,
  type CreateRecompensaDto,
  type ListMovimentosDto,
  type ResgatarDto,
  type UpdateProgramaDto,
  type UpdateRecompensaDto,
} from './fidelidade.dto';
import { FidelidadeService } from './fidelidade.service';

@ApiTags('fidelidade')
@ApiBearerAuth()
@Controller('fidelidade')
export class FidelidadeController {
  constructor(private readonly svc: FidelidadeService) {}

  // ─── Programa ─────────────────────────────────────────────────────────

  @Get('programa')
  @RequirePermissions({ module: 'fidelidade', action: 'view' })
  @ApiOperation({ summary: 'Configuração do programa de fidelidade da empresa' })
  getPrograma(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getPrograma(user);
  }

  @Patch('programa')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'update_programa', resource: 'fidelidade' })
  @ApiOperation({
    summary: 'Atualiza config do programa. **DIRETOR-only (D45)** — regra contratual.',
  })
  updatePrograma(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateProgramaSchema)) dto: UpdateProgramaDto,
  ) {
    return this.svc.updatePrograma(user, dto);
  }

  // ─── Recompensas ──────────────────────────────────────────────────────

  @Get('recompensas')
  @RequirePermissions({ module: 'fidelidade', action: 'view' })
  @ApiOperation({ summary: 'Lista recompensas ativas da empresa' })
  listRecompensas(
    @CurrentUser() user: AuthenticatedUser,
    @Query('incluirInativas') incluirInativas?: string,
  ) {
    return this.svc.listRecompensas(user, incluirInativas === 'true');
  }

  @Post('recompensas')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({
    action: 'create',
    resource: 'recompensa_fidelidade',
    resourceIdFrom: 'response.id',
  })
  @ApiOperation({ summary: 'Cria recompensa. **DIRETOR-only**.' })
  createRecompensa(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRecompensaSchema)) dto: CreateRecompensaDto,
  ) {
    return this.svc.createRecompensa(user, dto);
  }

  @Patch('recompensas/:id')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({
    action: 'update',
    resource: 'recompensa_fidelidade',
    resourceIdFrom: 'params.id',
  })
  updateRecompensa(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRecompensaSchema)) dto: UpdateRecompensaDto,
  ) {
    return this.svc.updateRecompensa(user, id, dto);
  }

  @Delete('recompensas/:id')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.OK)
  @Audit({
    action: 'deactivate',
    resource: 'recompensa_fidelidade',
    resourceIdFrom: 'params.id',
  })
  desativarRecompensa(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.desativarRecompensa(user, id);
  }

  // ─── Saldo + extrato ──────────────────────────────────────────────────

  @Get('saldo/:clienteId')
  @RequirePermissions({ module: 'fidelidade', action: 'view' })
  @ApiOperation({ summary: 'Saldo de pontos do cliente' })
  getSaldo(@CurrentUser() user: AuthenticatedUser, @Param('clienteId') clienteId: string) {
    return this.svc.getSaldo(user, clienteId);
  }

  @Get('movimentos')
  @RequirePermissions({ module: 'fidelidade', action: 'view' })
  @ApiOperation({ summary: 'Extrato de movimentos (filtros: cliente, tipo, paginação)' })
  listMovimentos(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listMovimentosSchema)) params: ListMovimentosDto,
  ) {
    return this.svc.listMovimentos(user, params);
  }

  // ─── Resgate + ajuste ─────────────────────────────────────────────────

  @Post('resgatar')
  @RequirePermissions({ module: 'fidelidade', action: 'edit' })
  @Audit({
    action: 'resgatar',
    resource: 'fidelidade',
    resourceIdFrom: 'response.movimento.id',
  })
  @ApiOperation({ summary: 'Resgata recompensa pra cliente (debita saldo + estoque)' })
  resgatar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(resgatarSchema)) dto: ResgatarDto,
  ) {
    return this.svc.resgatar(user, dto);
  }

  @Post('ajustar')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'ajustar_pontos', resource: 'fidelidade' })
  @ApiOperation({
    summary: 'Ajuste manual de pontos (+/-). **DIRETOR-only** — motivo obrigatório, fica em audit.',
  })
  ajustar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ajustarSchema)) dto: AjustarDto,
  ) {
    return this.svc.ajustar(user, dto);
  }

  @Get('ranking')
  @RequirePermissions({ module: 'fidelidade', action: 'view' })
  @ApiOperation({ summary: 'Top clientes por saldo de pontos (dashboard)' })
  ranking(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    const n = Math.min(50, Math.max(1, parseInt(limit ?? '10', 10) || 10));
    return this.svc.ranking(user, n);
  }
}
