import { Module } from '@nestjs/common';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';
import { AsaasWebhookController, CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

/**
 * Pagamento online da vitrine (Asaas). Entrega 1: ligar a conta da empresa e
 * receber os avisos de pagamento. A cobrança e a confirmação automática do
 * pedido vêm na entrega 2.
 */
@Module({
  imports: [IntegracoesModule],
  controllers: [CheckoutController, AsaasWebhookController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
