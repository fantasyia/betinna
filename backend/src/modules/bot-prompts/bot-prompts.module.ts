import { Module, forwardRef } from '@nestjs/common';
import { MullerBotModule } from '@modules/mullerbot/mullerbot.module';
import { BotPromptsController } from './bot-prompts.controller';
import { BotPromptsService } from './bot-prompts.service';
import { VariavelCustomizadaController } from './variavel-customizada.controller';
import { VariavelCustomizadaService } from './variavel-customizada.service';

@Module({
  // forwardRef: o MullerBotModule já importa ESTE módulo (usa BotPromptsService
  // pra montar o system prompt). Precisamos do caminho de volta só pra validar
  // o `modelo` contra a lista viva da OpenAI — mesma checagem da config do bot.
  imports: [forwardRef(() => MullerBotModule)],
  controllers: [BotPromptsController, VariavelCustomizadaController],
  providers: [BotPromptsService, VariavelCustomizadaService],
  exports: [BotPromptsService],
})
export class BotPromptsModule {}
