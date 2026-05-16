import { Global, Module } from '@nestjs/common';
import { CanalAdapterRegistry } from './canal-adapter.registry';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

/**
 * InboxModule é `@Global` porque adapters de canal (em outros módulos)
 * precisam injetar `InboxService` + `CanalAdapterRegistry` pra plugar.
 */
@Global()
@Module({
  controllers: [InboxController],
  providers: [InboxService, CanalAdapterRegistry],
  exports: [InboxService, CanalAdapterRegistry],
})
export class InboxModule {}
