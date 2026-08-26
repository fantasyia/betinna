import { Module } from '@nestjs/common';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';
import { TinyClientService } from './tiny-client.service';
import { TinyOAuthController } from './tiny-oauth.controller';
import { TinyOAuthService } from './tiny-oauth.service';
import { TinyTokenRefreshJob } from './tiny-token-refresh.job';
import { TinyWebhookController } from './tiny-webhook.controller';

/**
 * Integração com o Tiny (Olist) — o ERP a partir de 26/08/2026 (D50).
 *
 * Estado: OAuth + cliente HTTP + receptor de webhook. Os syncs (produtos,
 * estoque, contatos), o push de pedido e o processamento dos eventos são os
 * itens 4–7 do plano em `docs/erp-tiny-olist.md`.
 */
@Module({
  imports: [IntegracoesModule],
  controllers: [TinyOAuthController, TinyWebhookController],
  providers: [TinyOAuthService, TinyClientService, TinyTokenRefreshJob],
  exports: [TinyOAuthService, TinyClientService],
})
export class TinyModule {}
