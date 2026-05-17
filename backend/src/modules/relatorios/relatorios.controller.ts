import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type PeriodoDto, periodoSchema } from './relatorios.dto';
import { RelatoriosService } from './relatorios.service';

@ApiTags('relatorios')
@ApiBearerAuth()
@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly relatorios: RelatoriosService) {}

  @Get('dashboard')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary: 'Dashboard executivo — KPIs unificados de vendas, funil, SAC, campanhas e amostras',
  })
  dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(periodoSchema)) params: PeriodoDto,
  ) {
    return this.relatorios.dashboard(user, params);
  }

  @Get('vendas')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary: 'KPIs de vendas: faturamento, ticket médio, por status e por representante',
  })
  vendas(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(periodoSchema)) params: PeriodoDto,
  ) {
    return this.relatorios.vendas(user, params);
  }

  @Get('funil')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary: 'Pipeline de leads: snapshot do funil, taxa de conversão, aging por etapa e por rep',
  })
  funil(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(periodoSchema)) params: PeriodoDto,
  ) {
    return this.relatorios.funil(user, params);
  }

  @Get('comissoes')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary:
      'Comissões: total pago / a pagar por período, detalhamento por rep e tipo (REP/GERENTE)',
  })
  comissoes(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(periodoSchema)) params: PeriodoDto,
  ) {
    return this.relatorios.comissoes(user, params);
  }

  @Get('sac')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary:
      'SAC & Ocorrências: volume, SLA estourado, tempo médio de resolução, por severidade e tipo',
  })
  sac(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(periodoSchema)) params: PeriodoDto,
  ) {
    return this.relatorios.sac(user, params);
  }

  @Get('campanhas')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary: 'Performance de campanhas: taxa de envio, leitura, por canal e lista detalhada',
  })
  campanhas(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(periodoSchema)) params: PeriodoDto,
  ) {
    return this.relatorios.campanhas(user, params);
  }

  @Get('amostras')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary: 'Amostras: enviadas, convertidas, expiradas, taxa de conversão e valor convertido',
  })
  amostras(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(periodoSchema)) params: PeriodoDto,
  ) {
    return this.relatorios.amostras(user, params);
  }

  @Get('fidelidade')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary:
      'Fidelidade: pontos creditados/resgatados/expirados, saldo total, taxa de uso, top clientes',
  })
  fidelidade(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(periodoSchema)) params: PeriodoDto,
  ) {
    return this.relatorios.fidelidade(user, params);
  }
}
