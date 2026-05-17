import { Global, Module, forwardRef } from '@nestjs/common';
import { MetaModule } from '@integrations/meta/meta.module';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { CanalAdapterRegistry } from './canal-adapter.registry';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

/**
 * InboxModule é `@Global` porque adapters de canal (em outros módulos)
 * precisam injetar `InboxService` + `CanalAdapterRegistry` pra plugar.
 *
 * Importa WhatsAppModule + MetaModule via forwardRef pra disponibilizar
 * MediaServices no controller (signed URLs por canal). Esses módulos
 * dependem de InboxService — daí a referência circular resolvida por forwardRef.
 */
@Global()
@Module({
  imports: [forwardRef(() => WhatsAppModule), forwardRef(() => MetaModule)],
  controllers: [InboxController],
  providers: [InboxService, CanalAdapterRegistry],
  exports: [InboxService, CanalAdapterRegistry],
})
export class InboxModule {}
