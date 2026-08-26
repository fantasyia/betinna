import { Module } from '@nestjs/common';
import { TinyWebhookController } from './tiny-webhook.controller';

/**
 * Integração com o Tiny (Olist) — o ERP a partir de 26/08/2026 (D50).
 *
 * Nasce só com o receptor de webhook, porque o painel do Tiny valida a URL
 * antes de deixar salvar. O cliente HTTP com OAuth, os syncs e o processamento
 * dos eventos entram nos itens 2–7 do plano em `docs/erp-tiny-olist.md`.
 */
@Module({
  controllers: [TinyWebhookController],
})
export class TinyModule {}
