import { Module } from '@nestjs/common';
import { LeadsModule } from '@modules/leads/leads.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  imports: [LeadsModule],
  controllers: [CrmController],
  providers: [CrmService],
})
export class CrmModule {}
