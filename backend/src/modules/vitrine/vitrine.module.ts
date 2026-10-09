import { Module } from '@nestjs/common';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { ErpModule } from '@modules/erp/erp.module';
import { FinanceiroModule } from '@modules/financeiro/financeiro.module';
import { CheckoutModule } from '@modules/checkout/checkout.module';
import { PrecificacaoController } from './precificacao.controller';
import { PrecificacaoService } from './precificacao.service';
import { VitrineAdminController } from './vitrine-admin.controller';
import { VitrineAdminService } from './vitrine-admin.service';
import { VitrineFotosService } from './vitrine-fotos.service';
import { VitrineMidiaController } from './vitrine-midia.controller';
import { VitrinePublicaController } from './vitrine-publica.controller';
import { VitrinePublicaService } from './vitrine-publica.service';
import { VitrinePedidoService } from './vitrine-pedido.service';
import { FreteService } from './frete.service';
import { PrivacidadeService } from './privacidade.service';
import { MetaPixelService } from './meta-pixel.service';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';

/**
 * Vitrine de atacado (Fase 1 — Ribelt Distribuidora Têxtil, 05/10/2026).
 * Ligada POR EMPRESA (tabela `Vitrine`); sem ela, nada daqui age.
 * A calculadora de precificação (06/10) tem flag própria em `Empresa.config`.
 */
@Module({
  // O pedido da vitrine acende fluxo (PEDIDO_CRIADO) e avisa a equipe.
  // ERP: o pedido enviado reserva as peças por 20 min.
  // Frete: o token do Melhor Envio é credencial cifrada de Integrações.
  imports: [
    FluxosModule,
    NotificacoesModule,
    ErpModule,
    FinanceiroModule,
    CheckoutModule,
    IntegracoesModule,
  ],
  controllers: [
    VitrineAdminController,
    VitrineMidiaController,
    VitrinePublicaController,
    PrecificacaoController,
  ],
  providers: [
    VitrineAdminService,
    VitrineFotosService,
    VitrinePublicaService,
    VitrinePedidoService,
    FreteService,
    PrivacidadeService,
    MetaPixelService,
    PrecificacaoService,
  ],
  exports: [VitrineAdminService, VitrineFotosService],
})
export class VitrineModule {}
