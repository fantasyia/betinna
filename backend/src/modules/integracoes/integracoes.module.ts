import { Global, Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
import { IntegracaoStatusService } from './integracao-status.service';
import { IntegracoesController } from './integracoes.controller';
import { IntegracoesService } from './integracoes.service';
import { ValidadeCredencialJob } from './validade-credencial.job';
import { UsuarioIntegracoesController } from './usuario-integracoes.controller';
import { UsuarioIntegracoesService } from './usuario-integracoes.service';
import { EvolutionModule } from '@integrations/evolution/evolution.module';

@Global()
@Module({
  imports: [EmailModule, EvolutionModule],
  controllers: [IntegracoesController, UsuarioIntegracoesController],
  providers: [
    IntegracoesService,
    UsuarioIntegracoesService,
    IntegracaoStatusService,
    ValidadeCredencialJob,
  ],
  exports: [IntegracoesService, UsuarioIntegracoesService, IntegracaoStatusService],
})
export class IntegracoesModule {}
