import { Module } from '@nestjs/common';
import { BotPromptsController } from './bot-prompts.controller';
import { BotPromptsService } from './bot-prompts.service';

@Module({
  controllers: [BotPromptsController],
  providers: [BotPromptsService],
  exports: [BotPromptsService],
})
export class BotPromptsModule {}
