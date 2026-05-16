import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionsModule } from '@modules/permissions/permissions.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';
import { RefreshTokenService } from './refresh-token.service';
import { SupabaseAuthService } from './supabase-auth.service';

@Global()
@Module({
  imports: [PermissionsModule],
  controllers: [AuthController],
  providers: [
    SupabaseAuthService,
    RefreshTokenService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
    // Registra os guards globalmente — todo endpoint passa por eles
    // a menos que marcado com @Public()
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [SupabaseAuthService, RefreshTokenService],
})
export class AuthModule {}
