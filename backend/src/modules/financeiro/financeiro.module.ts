import { Module } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';
import { RecorrenciasJob } from './recorrencias.job';

/**
 * ERP próprio · Fase 3 — contas a pagar e a receber (sem NF-e), Ribelt
 * Distribuidora (07/10/2026). Ligado por `Empresa.config.financeiro.ativo`.
 * Depende só do banco — quem gera título automático o importa.
 */
@Module({
  controllers: [FinanceiroController],
  providers: [FinanceiroService, RecorrenciasJob],
  exports: [FinanceiroService],
})
export class FinanceiroModule {}
