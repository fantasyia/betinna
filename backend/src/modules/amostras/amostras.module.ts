import { Module } from '@nestjs/common';
import { AmostrasController } from './amostras.controller';
import { AmostrasService } from './amostras.service';

@Module({
  controllers: [AmostrasController],
  providers: [AmostrasService],
  exports: [AmostrasService],
})
export class AmostrasModule {}
