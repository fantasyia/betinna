import { Global, Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
import { IntegracaoStatusService } from './integracao-status.service';
import { IntegracoesController } from './integracoes.controller';
import { IntegracoesService } from './integracoes.service';
import { UsuarioIntegracoesController } from './usuario-integracoes.controller';
import { UsuarioIntegracoesService } from './usuario-integracoes.service';

@Global()
@Module({
  imports: [EmailModule],
  controllers: [IntegracoesController, UsuarioIntegracoesController],
  providers: [IntegracoesService, UsuarioIntegracoesService, IntegracaoStatusService],
  exports: [IntegracoesService, UsuarioIntegracoesService, IntegracaoStatusService],
})
export class IntegracoesModule {}
