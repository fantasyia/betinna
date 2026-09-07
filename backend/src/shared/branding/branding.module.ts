import { Global, Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

/**
 * Global: quem monta link ou e-mail precisa saber de que tenant é a marca, e
 * isso acontece em pontos espalhados (convite, reset de senha, notificação).
 */
@Global()
@Module({
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
