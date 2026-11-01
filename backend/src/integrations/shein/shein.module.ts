import { Module } from '@nestjs/common';
import { SheinClientService } from './shein.client';
import { SheinController } from './shein.controller';
import { SheinOAuthService } from './shein-oauth.service';
import { SheinOrdersService } from './shein-orders.service';

/** Shein (Open API): autorização da loja + pedidos, só leitura (01/11). */
@Module({
  controllers: [SheinController],
  providers: [SheinClientService, SheinOAuthService, SheinOrdersService],
  exports: [SheinClientService, SheinOrdersService],
})
export class SheinModule {}
