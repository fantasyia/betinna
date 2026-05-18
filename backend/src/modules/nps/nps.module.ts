import { Module } from '@nestjs/common';
import { NpsController, NpsPublicoController } from './nps.controller';
import { NpsService } from './nps.service';

@Module({
  controllers: [NpsController, NpsPublicoController],
  providers: [NpsService],
  exports: [NpsService],
})
export class NpsModule {}
