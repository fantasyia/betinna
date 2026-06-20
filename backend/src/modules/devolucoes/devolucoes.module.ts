import { Module } from '@nestjs/common';
import { DevolucoesController } from './devolucoes.controller';
import { DevolucoesService } from './devolucoes.service';

@Module({
  controllers: [DevolucoesController],
  providers: [DevolucoesService],
  exports: [DevolucoesService],
})
export class DevolucoesModule {}
