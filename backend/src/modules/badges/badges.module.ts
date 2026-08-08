import { Module } from '@nestjs/common';
import { RepScopeModule } from '@shared/scope/rep-scope.module';
import { BadgesController } from './badges.controller';
import { BadgesService } from './badges.service';

@Module({
  imports: [RepScopeModule],
  controllers: [BadgesController],
  providers: [BadgesService],
})
export class BadgesModule {}
