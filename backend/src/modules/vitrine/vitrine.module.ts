import { Module } from '@nestjs/common';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { VitrineAdminController } from './vitrine-admin.controller';
import { VitrineAdminService } from './vitrine-admin.service';
import { VitrineFotosService } from './vitrine-fotos.service';
import { VitrineMidiaController } from './vitrine-midia.controller';
import { VitrinePublicaController } from './vitrine-publica.controller';
import { VitrinePublicaService } from './vitrine-publica.service';
import { VitrinePedidoService } from './vitrine-pedido.service';

/**
 * Vitrine de atacado (Fase 1 — Ribelt Distribuidora Têxtil, 05/10/2026).
 * Ligada POR EMPRESA (tabela `Vitrine`); sem ela, nada daqui age.
 */
@Module({
  // O pedido da vitrine acende fluxo (PEDIDO_CRIADO) e avisa a equipe.
  imports: [FluxosModule, NotificacoesModule],
  controllers: [VitrineAdminController, VitrineMidiaController, VitrinePublicaController],
  providers: [
    VitrineAdminService,
    VitrineFotosService,
    VitrinePublicaService,
    VitrinePedidoService,
  ],
  exports: [VitrineAdminService, VitrineFotosService],
})
export class VitrineModule {}
