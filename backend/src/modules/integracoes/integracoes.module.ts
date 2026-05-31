import { Global, Module } from '@nestjs/common';
import { SendGridModule } from '@integrations/sendgrid/sendgrid.module';
import { IntegracaoStatusService } from './integracao-status.service';
import { IntegracoesController } from './integracoes.controller';
import { IntegracoesService } from './integracoes.service';
import { UsuarioIntegracoesController } from './usuario-integracoes.controller';
import { UsuarioIntegracoesService } from './usuario-integracoes.service';

@Global()
@Module({
  imports: [SendGridModule],
  controllers: [IntegracoesController, UsuarioIntegracoesController],
  providers: [IntegracoesService, UsuarioIntegracoesService, IntegracaoStatusService],
  exports: [IntegracoesService, UsuarioIntegracoesService, IntegracaoStatusService],
})
export class IntegracoesModule {}
