import { Module } from '@nestjs/common';
import { CtwaCampanhaService } from './ctwa-campanha.service';
import { MetaAppService } from './meta-app.service';
import { MetaGraphClientService } from './meta-graph-client.service';

/**
 * Peças da Meta SEM dependência de módulo de negócio (29/09): o cliente da
 * Graph, o app da empresa e o resolvedor da campanha do Click-to-WhatsApp.
 *
 * Existe pra o InboxModule (e quem mais precisar) usar a Graph sem importar o
 * MetaModule inteiro — que depende de Leads → Fluxos, e fecharia ciclo. Só usa
 * providers globais (Http, Env, Redis, Integrações).
 */
@Module({
  providers: [MetaGraphClientService, MetaAppService, CtwaCampanhaService],
  exports: [MetaGraphClientService, MetaAppService, CtwaCampanhaService],
})
export class MetaGraphModule {}
