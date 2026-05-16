import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { WhatsAppSessionService } from './whatsapp-session.service';

/**
 * WhatsApp **pessoal** — cada usuário (rep) conecta o próprio celular.
 *
 * Cada chamada opera SEMPRE no usuário autenticado (`user.id`). Não há
 * cross-user — admin não conecta WhatsApp de outro rep pela API; cada rep
 * faz o próprio pareamento.
 *
 * REP usa esses endpoints; ADMIN/DIRECTOR/GERENTE/SAC também (se quiserem
 * conectar o próprio celular).
 */
@ApiTags('usuario/integracoes/whatsapp')
@ApiBearerAuth()
@Controller('usuario/integracoes/whatsapp')
export class WhatsAppUsuarioController {
  constructor(private readonly sessions: WhatsAppSessionService) {}

  @Get('status')
  @ApiOperation({ summary: 'Status do meu WhatsApp pessoal (incluindo QR quando pendente)' })
  status(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    return this.sessions.statusUsuario(user.id, empresaId);
  }

  @Post('conectar')
  // Throttle: 5 req/hora — gera QR é caro e propenso a abuse
  @Throttle({ default: { limit: 5, ttl: seconds(60 * 60) } })
  @Audit({ action: 'whatsapp_usuario_conectar', resource: 'integracao' })
  @ApiOperation({
    summary: 'Conecta meu WhatsApp pessoal. Primeira vez retorna QR pra escanear.',
  })
  async conectar(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    return this.sessions.iniciarUsuario(user.id, empresaId);
  }

  @Delete('desconectar')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'whatsapp_usuario_desconectar', resource: 'integracao' })
  async desconectar(@CurrentUser() user: AuthenticatedUser) {
    await this.sessions.desconectarUsuario(user.id);
    return { ok: true };
  }

  @Delete('resetar')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'whatsapp_usuario_resetar', resource: 'integracao' })
  @ApiOperation({
    summary: 'Apaga credenciais do meu WhatsApp — próxima conexão exige novo QR',
  })
  async resetar(@CurrentUser() user: AuthenticatedUser) {
    await this.sessions.resetarUsuario(user.id);
    return { ok: true };
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }
}
