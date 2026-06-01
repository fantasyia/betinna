import { Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
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
  imports: [EmailModule],
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
  exports: [MullerBotService, ProdutoSearchService, MullerBotPersonaService],
})
export class MullerBotModule {}
