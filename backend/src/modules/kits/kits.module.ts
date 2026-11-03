import { Module } from '@nestjs/common';
import { VitrineModule } from '@modules/vitrine/vitrine.module';
import { KitsController } from './kits.controller';
import { KitsService } from './kits.service';

/** Kits dos marketplaces no ERP, com composição — fora da vitrine (25/10). */
@Module({
  imports: [VitrineModule],
  controllers: [KitsController],
  providers: [KitsService],
  exports: [KitsService],
})
export class KitsModule {}
