import { Module } from '@nestjs/common';
import { BotPromptsController } from './bot-prompts.controller';
import { BotPromptsService } from './bot-prompts.service';
import { VariavelCustomizadaController } from './variavel-customizada.controller';
import { VariavelCustomizadaService } from './variavel-customizada.service';

@Module({
  controllers: [BotPromptsController, VariavelCustomizadaController],
  providers: [BotPromptsService, VariavelCustomizadaService],
  exports: [BotPromptsService],
})
export class BotPromptsModule {}
