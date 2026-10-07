import { Module } from '@nestjs/common';
import { FinanceiroModule } from '@modules/financeiro/financeiro.module';
import { EstoqueController } from './estoque.controller';
import { EstoqueService } from './estoque.service';
import { ReservaExpiracaoJob } from './reserva-expiracao.job';
import { InsumosController } from './insumos.controller';
import { InsumosService } from './insumos.service';
import { FichasController } from './fichas.controller';
import { FichasService } from './fichas.service';
import { OrdensController } from './ordens.controller';
import { OrdensService } from './ordens.service';
import { EncaixeAgenteController, EncaixeController } from './encaixe.controller';
import { EncaixeService } from './encaixe.service';

/**
 * ERP próprio · Fase 2 (Ribelt Distribuidora Têxtil, 07/10/2026).
 * Ligado POR EMPRESA em `Empresa.config.erpInterno.ativo`; sem a flag, nada
 * daqui age. Depende só do banco — Pedidos e Vitrine o importam (nunca o
 * contrário), pra não fechar ciclo de módulo.
 */
@Module({
  // Financeiro (Fase 3) só depende do banco: gera os títulos automáticos daqui.
  imports: [FinanceiroModule],
  controllers: [
    EstoqueController,
    InsumosController,
    FichasController,
    OrdensController,
    EncaixeController,
    EncaixeAgenteController,
  ],
  providers: [
    EstoqueService,
    ReservaExpiracaoJob,
    InsumosService,
    FichasService,
    OrdensService,
    EncaixeService,
  ],
  exports: [EstoqueService, FichasService, OrdensService],
})
export class ErpModule {}
