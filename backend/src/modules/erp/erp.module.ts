import { Module } from '@nestjs/common';
import { EstoqueController } from './estoque.controller';
import { EstoqueService } from './estoque.service';
import { ReservaExpiracaoJob } from './reserva-expiracao.job';
import { InsumosController } from './insumos.controller';
import { InsumosService } from './insumos.service';
import { FichasController } from './fichas.controller';
import { FichasService } from './fichas.service';

/**
 * ERP próprio · Fase 2 (Ribelt Distribuidora Têxtil, 07/10/2026).
 * Ligado POR EMPRESA em `Empresa.config.erpInterno.ativo`; sem a flag, nada
 * daqui age. Depende só do banco — Pedidos e Vitrine o importam (nunca o
 * contrário), pra não fechar ciclo de módulo.
 */
@Module({
  controllers: [EstoqueController, InsumosController, FichasController],
  providers: [EstoqueService, ReservaExpiracaoJob, InsumosService, FichasService],
  exports: [EstoqueService, FichasService],
})
export class ErpModule {}
