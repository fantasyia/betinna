import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EnvService } from '@config/env.service';
import { EvolutionService } from '@integrations/evolution/evolution.service';
import { EvolutionInstanciaService } from '@integrations/evolution/evolution-instancia.service';
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
  constructor(
    private readonly sessions: WhatsAppSessionService,
    private readonly env: EnvService,
    private readonly evolution: EvolutionService,
    private readonly instancias: EvolutionInstanciaService,
  ) {}

  private get viaEvolution(): boolean {
    return this.env.get('WHATSAPP_PROVIDER') === 'evolution';
  }

  private instancia(empresaId: string): string {
    return EvolutionService.instanceName({ type: 'EMPRESA', id: empresaId });
  }

  @Get('status')
  @Roles('ADMIN', 'DIRECTOR', 'SAC')
  @ApiOperation({
    summary: 'Status do WhatsApp empresa (incluindo qrDataUrl quando pendente)',
  })
  status(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    if (this.viaEvolution) return this.evolution.estadoComQr(this.instancia(empresaId));
    return this.sessions.statusEmpresa(empresaId);
  }

  @Get('instancias')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({
    summary: 'Painel do diretor: status de TODAS as instâncias WhatsApp (empresa + reps)',
  })
  listarInstancias(@CurrentUser() user: AuthenticatedUser) {
    return this.instancias.listarDaEmpresa(this.requireEmpresa(user));
  }

  @Post('conectar')
  @Roles('ADMIN', 'DIRECTOR')
  // Throttle: pairing é caro (reset forte + cria instância). 12/min por user
  // previne loop acidental sem travar reconexão/debug legítimos (5/hora era pouco).
  @Throttle({ default: { limit: 12, ttl: seconds(60) } })
  @Audit({ action: 'whatsapp_empresa_conectar', resource: 'integracao' })
  @ApiOperation({
    summary:
      'Inicia sessão Baileys da empresa. Primeiro pareamento retorna QR. **DIRETOR-only (D45)**.',
  })
  async conectar(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    if (this.viaEvolution) return this.evolution.conectarOuEstado(this.instancia(empresaId));
    return this.sessions.iniciarEmpresa(empresaId);
  }

  @Delete('desconectar')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'whatsapp_empresa_desconectar', resource: 'integracao' })
  @ApiOperation({ summary: 'Desconecta WhatsApp empresa. **DIRETOR-only (D45)**.' })
  async desconectar(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    if (this.viaEvolution)
      await this.evolution.logout(this.instancia(empresaId)).catch(() => undefined);
    else await this.sessions.desconectarEmpresa(empresaId);
    return { ok: true };
  }

  @Delete('resetar')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'whatsapp_empresa_resetar', resource: 'integracao' })
  @ApiOperation({
    summary:
      'Apaga credenciais do WhatsApp empresa — próxima conexão exige novo QR. **DIRETOR-only (D45)**.',
  })
  async resetar(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    if (this.viaEvolution)
      await this.evolution.resetarForte(this.instancia(empresaId)).catch(() => undefined);
    else await this.sessions.resetarEmpresa(empresaId);
    return { ok: true };
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }
}
