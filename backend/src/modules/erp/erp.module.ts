import { Module } from '@nestjs/common';
import { FinanceiroModule } from '@modules/financeiro/financeiro.module';
import { EstoqueController } from './estoque.controller';
import { EstoqueService } from './estoque.service';
import { ReservaExpiracaoJob } from './reserva-expiracao.job';
import { InsumosController } from './insumos.controller';
import { InsumosService } from './insumos.service';
import { InsumoFotosService } from './insumo-fotos.service';
import { FichasController } from './fichas.controller';
import { FichasService } from './fichas.service';
import { OrdensController } from './ordens.controller';
import { OrdensService } from './ordens.service';
import { FichaImpressaoService } from './ficha-impressao.service';
import { EncaixeAgenteController, EncaixeController } from './encaixe.controller';
import { EncaixeService } from './encaixe.service';
import { EtiquetasController } from './etiquetas.controller';
import { EtiquetasService } from './etiquetas.service';

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
    EtiquetasController,
  ],
  providers: [
    EstoqueService,
    ReservaExpiracaoJob,
    InsumosService,
    InsumoFotosService,
    FichasService,
    OrdensService,
    FichaImpressaoService,
    EncaixeService,
    EtiquetasService,
  ],
  exports: [EstoqueService, FichasService, OrdensService],
})
export class ErpModule {}
