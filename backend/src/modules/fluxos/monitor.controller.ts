import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { MonitorService } from './monitor.service';

@ApiTags('orquestracao')
@ApiBearerAuth()
@Controller('orquestracao')
export class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  @Get('monitor')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({
    summary: 'Painel de saúde do funil (leads por etapa, IA ativa, SLAs vencidos, execuções)',
  })
  resumo(@CurrentUser() user: AuthenticatedUser) {
    return this.monitor.resumo(user);
  }

  @Get('filas')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({
    summary:
      'Fila de envios: pendências de campanhas (e-mail/WhatsApp) da empresa + filas técnicas (ADMIN)',
  })
  filas(@CurrentUser() user: AuthenticatedUser) {
    return this.monitor.filas(user);
  }
}
