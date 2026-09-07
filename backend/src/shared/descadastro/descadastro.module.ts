import { Global, Module } from '@nestjs/common';
import { DescadastroController } from './descadastro.controller';
import { DescadastroService } from './descadastro.service';

/**
 * Global: quem manda e-mail de marketing precisa do token do destinatário, e
 * isso acontece em pontos espalhados (campanhas, réguas de fluxo). Mesma razão
 * do SupressaoModule ser global — são as duas metades da mesma regra.
 */
@Global()
@Module({
  controllers: [DescadastroController],
  providers: [DescadastroService],
  exports: [DescadastroService],
})
export class DescadastroModule {}
