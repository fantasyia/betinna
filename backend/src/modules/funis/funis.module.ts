import { Module } from '@nestjs/common';
import { FunisController } from './funis.controller';
import { FunisService } from './funis.service';

@Module({
  controllers: [FunisController],
  providers: [FunisService],
  exports: [FunisService],
})
export class FunisModule {}
