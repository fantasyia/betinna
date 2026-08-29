import { Module } from '@nestjs/common';
import { PedidoStatusBotModule } from '@modules/pedidos/pedido-status-bot.module';
import { EmailModule } from '@integrations/email/email.module';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { BotPromptsModule } from '@modules/bot-prompts/bot-prompts.module';
import { RagModule } from '@modules/rag/rag.module';
import { MullerBotController } from './mullerbot.controller';
import { MullerBotService } from './mullerbot.service';
import { MullerBotCacheService } from './mullerbot-cache.service';
import { ProdutoSearchService } from './produto-search.service';
import { MullerBotPersonaController } from './persona.controller';
import { MullerBotPersonaService } from './persona.service';
import { MullerWhatsappService } from './muller-whatsapp.service';
import { BotAuditoriaService } from './bot-auditoria.service';
import { BotCustoService } from './bot-custo.service';
import { BotAuditoriaController } from './bot-auditoria.controller';

@Module({
  // Só o módulo do STATUS de pedido: importar o PedidosModule inteiro fecharia
  // um ciclo (Pedidos → Fluxos → … → MullerBot) e o Nest nem sobe.
  imports: [EmailModule, WhatsAppModule, BotPromptsModule, RagModule, PedidoStatusBotModule],
  controllers: [MullerBotController, MullerBotPersonaController, BotAuditoriaController],
  providers: [
    MullerBotService,
    MullerBotCacheService,
    ProdutoSearchService,
    MullerBotPersonaService,
    // Fase 2 — motor do bot no WhatsApp (registra o hook no Inbox no boot)
    MullerWhatsappService,
    // Sprint 2.2 — auditoria das respostas + teto de custo
    BotAuditoriaService,
    BotCustoService,
  ],
  exports: [MullerBotService, ProdutoSearchService, MullerBotPersonaService, BotCustoService],
})
export class MullerBotModule {}
