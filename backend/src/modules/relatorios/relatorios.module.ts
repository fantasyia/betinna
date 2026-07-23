import { Module } from '@nestjs/common';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';
import { DashboardResumoController } from './dashboard-resumo.controller';
import { DashboardResumoService } from './dashboard-resumo.service';

@Module({
  controllers: [RelatoriosController, DashboardResumoController],
  providers: [RelatoriosService, DashboardResumoService],
  exports: [RelatoriosService],
})
export class RelatoriosModule {}
