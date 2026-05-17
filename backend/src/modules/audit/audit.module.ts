import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { RetentionCleanupJob } from './retention-cleanup.job';

@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    RetentionCleanupJob,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
