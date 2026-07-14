import { Global, Module } from '@nestjs/common';
import { SupressaoService } from './supressao.service';

/** Global: o guard de supressão LGPD é injetável em qualquer ponto de envio. */
@Global()
@Module({
  providers: [SupressaoService],
  exports: [SupressaoService],
})
export class SupressaoModule {}
