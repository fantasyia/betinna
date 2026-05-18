import { Module } from '@nestjs/common';
import { SegmentosController } from './segmentos.controller';
import { SegmentosService } from './segmentos.service';

@Module({
  controllers: [SegmentosController],
  providers: [SegmentosService],
  exports: [SegmentosService],
})
export class SegmentosModule {}
