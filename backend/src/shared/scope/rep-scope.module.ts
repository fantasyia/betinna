import { Global, Module } from '@nestjs/common';
import { RepScopeService } from './rep-scope.service';

@Global()
@Module({
  providers: [RepScopeService],
  exports: [RepScopeService],
})
export class RepScopeModule {}
