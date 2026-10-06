import { Module } from '@nestjs/common';
import { EstoqueController } from './estoque.controller';
import { EstoqueService } from './estoque.service';
import { ReservaExpiracaoJob } from './reserva-expiracao.job';

/**
 * ERP próprio · Fase 2 (Ribelt Distribuidora Têxtil, 07/10/2026).
 * Ligado POR EMPRESA em `Empresa.config.erpInterno.ativo`; sem a flag, nada
 * daqui age. Depende só do banco — Pedidos e Vitrine o importam (nunca o
 * contrário), pra não fechar ciclo de módulo.
 */
@Module({
  controllers: [EstoqueController],
  providers: [EstoqueService, ReservaExpiracaoJob],
  exports: [EstoqueService],
})
export class ErpModule {}
