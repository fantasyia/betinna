import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type GraficosDto, graficosSchema } from './relatorios.dto';
import { DashboardResumoService } from './dashboard-resumo.service';

/**
 * Endpoint ÚNICO de agregação do dashboard-cockpit. O front monta a tela com
 * UMA chamada (pulso + triagem + prontidão + sala de fluxos) — regra do card:
 * nada de N requisições pra pintar a home.
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardResumoController {
  constructor(private readonly svc: DashboardResumoService) {}

  @Get('resumo')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary:
      'Agregação do dashboard: pulso (6 tiles) + fila "Precisa de você" + modo prontidão + sala de fluxos, numa chamada',
  })
  resumo(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.resumo(user);
  }

  @Get('graficos')
  @RequirePermissions({ module: 'relatorios', action: 'view' })
  @ApiOperation({
    summary:
      'M8 — séries dos gráficos de relatórios (leads/dia, UTM, conversão do funil, saúde dos fluxos, tempo por etapa) numa chamada',
  })
  graficos(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(graficosSchema)) params: GraficosDto,
  ) {
    return this.svc.graficos(user, params);
  }
}
