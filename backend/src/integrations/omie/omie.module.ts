import { Module } from '@nestjs/common';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { OmieAmostrasService } from './omie-amostras.service';
import { OmieClientService } from './omie-client.service';
import { OmieClientesService } from './omie-clientes.service';
import { OmieController } from './omie.controller';
import { OmieEstoqueJob } from './omie-estoque.job';
import { OmiePedidosService } from './omie-pedidos.service';
import { OmieProdutosService } from './omie-produtos.service';
import { OmieSyncJob } from './omie-sync.job';
import { OmieWebhookController } from './omie-webhook.controller';

/**
 * Módulo de integração com OMIE (ERP).
 *
 * Exporta os services higher-level para outros módulos consumirem:
 *  - OmieClientesService — sync de clientes
 *  - OmieProdutosService — sync de produtos
 *  - OmiePedidosService  — push de pedidos
 *
 * O OmieClientService (low-level) também é exportado, mas em geral só os
 * specialized services devem ser usados externamente.
 */
@Module({
  imports: [NotificacoesModule],
  controllers: [OmieController, OmieWebhookController],
  providers: [
    OmieClientService,
    OmieClientesService,
    OmieProdutosService,
    OmiePedidosService,
    OmieAmostrasService,
    OmieSyncJob,
    OmieEstoqueJob,
  ],
  exports: [
    OmieClientService,
    OmieClientesService,
    OmieProdutosService,
    OmiePedidosService,
    OmieAmostrasService,
    OmieSyncJob,
    OmieEstoqueJob,
  ],
})
export class OmieModule {}
