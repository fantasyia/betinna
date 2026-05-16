import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { RefreshTokenService } from './refresh-token.service';

const refreshTrackSchema = z.object({
  refreshToken: z.string().min(20),
});
type RefreshTrackDto = z.infer<typeof refreshTrackSchema>;

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
// Auditoria Sprint 2: rate limit estrito em endpoints de auth.
// 10 req/15min por IP — bloqueia brute force / token enumeration.
@Throttle({ default: { limit: 10, ttl: seconds(15 * 60) } })
export class AuthController {
  constructor(private readonly refreshTokens: RefreshTokenService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Retorna o usuário autenticado (validação do JWT + carregamento do contexto)',
  })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * Logout — invalida cache do AuthGuard + refresh tracking.
   * Frontend DEVE também chamar `supabase.auth.signOut()` para invalidar
   * o refresh token no Supabase (revoke).
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout: invalida cache local + tracking de refresh' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.refreshTokens.signOut(user);
  }

  /**
   * Endpoint de defesa em profundidade — frontend chama APÓS um refresh
   * bem-sucedido para registrar o novo `refreshToken` como o ATUAL.
   *
   * Se um token antigo for apresentado depois, detectamos reuse e
   * invalidamos todas as sessões do usuário.
   *
   * Supabase Auth já implementa rotation internamente; este endpoint é
   * camada EXTRA para detectar reuse no nosso lado.
   */
  @Post('refresh-track')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Registra novo refresh token como atual (chamado após refreshSession do Supabase)',
  })
  async trackRefresh(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(refreshTrackSchema)) dto: RefreshTrackDto,
  ): Promise<void> {
    await this.refreshTokens.assertCurrent(user.id, dto.refreshToken);
    // Marca o novo como atual — se passou assertCurrent (ou primeira vez), promove
    await this.refreshTokens.markCurrent(user.id, dto.refreshToken);
  }
}
