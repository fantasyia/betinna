import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { WhatsAppSessionService } from './whatsapp-session.service';

/**
 * WhatsApp **empresa** — número central operado pela equipe SAC.
 * Gerenciado por ADMIN/DIRECTOR. SAC vê o status mas não conecta.
 *
 * GERENTE NÃO acessa o número da empresa — usa o próprio WhatsApp pessoal via
 * `/usuario/integracoes/whatsapp/*` (mesmo endpoint dos reps).
 */
@ApiTags('integracoes/whatsapp')
@ApiBearerAuth()
@Controller('integracoes/whatsapp')
export class WhatsAppController {
  constructor(private readonly sessions: WhatsAppSessionService) {}

  @Get('status')
  @Roles('ADMIN', 'DIRECTOR', 'SAC')
  @ApiOperation({
    summary: 'Status do WhatsApp empresa (incluindo qrDataUrl quando pendente)',
  })
  status(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    return this.sessions.statusEmpresa(empresaId);
  }

  @Post('conectar')
  @Roles('ADMIN', 'DIRECTOR')
  // Throttle estrito: WhatsApp pairing é processo caro (gera QR + escuta socket).
  // 5 req/hora por user previne abuse / accidental loops.
  @Throttle({ default: { limit: 5, ttl: seconds(60 * 60) } })
  @Audit({ action: 'whatsapp_empresa_conectar', resource: 'integracao' })
  @ApiOperation({
    summary: 'Inicia sessão Baileys da empresa. Primeiro pareamento retorna QR.',
  })
  async conectar(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    return this.sessions.iniciarEmpresa(empresaId);
  }

  @Delete('desconectar')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'whatsapp_empresa_desconectar', resource: 'integracao' })
  async desconectar(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    await this.sessions.desconectarEmpresa(empresaId);
    return { ok: true };
  }

  @Delete('resetar')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'whatsapp_empresa_resetar', resource: 'integracao' })
  @ApiOperation({
    summary: 'Apaga credenciais do WhatsApp empresa — próxima conexão exige novo QR',
  })
  async resetar(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    await this.sessions.resetarEmpresa(empresaId);
    return { ok: true };
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }
}
