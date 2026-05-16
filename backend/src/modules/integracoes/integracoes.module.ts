import { Global, Module } from '@nestjs/common';
import { IntegracoesController } from './integracoes.controller';
import { IntegracoesService } from './integracoes.service';
import { UsuarioIntegracoesController } from './usuario-integracoes.controller';
import { UsuarioIntegracoesService } from './usuario-integracoes.service';

@Global()
@Module({
  controllers: [IntegracoesController, UsuarioIntegracoesController],
  providers: [IntegracoesService, UsuarioIntegracoesService],
  exports: [IntegracoesService, UsuarioIntegracoesService],
})
export class IntegracoesModule {}
