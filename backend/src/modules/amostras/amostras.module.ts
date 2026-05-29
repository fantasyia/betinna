import { Module } from '@nestjs/common';
import { OmieModule } from '@integrations/omie/omie.module';
import { AmostrasController } from './amostras.controller';
import { AmostrasService } from './amostras.service';

@Module({
  imports: [OmieModule],
  controllers: [AmostrasController],
  providers: [AmostrasService],
  exports: [AmostrasService],
})
export class AmostrasModule {}
