import { Module } from '@nestjs/common';
import { FinanceiroModule } from '@modules/financeiro/financeiro.module';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { AvisosAsaasJob } from './avisos-asaas.job';
import { CheckoutPublicoController } from './checkout-publico.controller';
import { CheckoutPublicoService } from './checkout-publico.service';
import { AsaasWebhookController, CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

/**
 * Pagamento online da vitrine (Asaas): ligar a conta da empresa (entrega 1),
 * cobrar o pedido pela vitrine e confirmar sozinho pelo aviso do Asaas
 * (entrega 2).
 */
@Module({
  // Fluxos: o pedido pago pelo Asaas dispara o gatilho PEDIDO_PAGO.
  imports: [IntegracoesModule, FinanceiroModule, NotificacoesModule, FluxosModule],
  controllers: [CheckoutController, AsaasWebhookController, CheckoutPublicoController],
  providers: [CheckoutService, CheckoutPublicoService, AvisosAsaasJob],
  exports: [CheckoutService, CheckoutPublicoService],
})
export class CheckoutModule {}
