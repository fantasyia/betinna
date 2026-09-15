import { Global, Module } from '@nestjs/common';
import { SupressaoService } from './supressao.service';

/**
 * Global: o guard de supressão LGPD é injetável em qualquer ponto de envio.
 *
 * ⚠️ NÃO importa o `FluxosModule` de propósito, mesmo precisando do barramento
 * pra acender o E5 (A25): o FluxosModule consome este serviço, e um global
 * importando o pesado cria ordem de instanciação que só quebra no boot. O
 * serviço resolve o barramento por `ModuleRef` na hora da chamada.
 */
@Global()
@Module({
  providers: [SupressaoService],
  exports: [SupressaoService],
})
export class SupressaoModule {}
