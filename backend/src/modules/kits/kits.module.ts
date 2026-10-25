import { Module } from '@nestjs/common';
import { KitsController } from './kits.controller';
import { KitsService } from './kits.service';

/** Kits dos marketplaces no ERP, com composição — fora da vitrine (25/10). */
@Module({
  controllers: [KitsController],
  providers: [KitsService],
  exports: [KitsService],
})
export class KitsModule {}
