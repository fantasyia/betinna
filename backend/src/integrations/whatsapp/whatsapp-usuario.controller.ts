import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { ThrottlePerUser } from '@shared/decorators/throttle-per-user.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EnvService } from '@config/env.service';
import { EvolutionService } from '@integrations/evolution/evolution.service';
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
 *
 * Roteia por `WHATSAPP_PROVIDER` (espelha o controller da empresa): provider
 * 'evolution' → instância `user_<id>` no Evolution API; senão → Baileys embutido.
 */
@ApiTags('usuario/integracoes/whatsapp')
@ApiBearerAuth()
// Recurso é POR-USUÁRIO (instância user_<id>) → rate-limit por user.id, não por
// empresa: senão um rep esgotaria a cota de connect/status de todos os reps do tenant.
@ThrottlePerUser()
@Controller('usuario/integracoes/whatsapp')
export class WhatsAppUsuarioController {
  constructor(
    private readonly sessions: WhatsAppSessionService,
    private readonly env: EnvService,
    private readonly evolution: EvolutionService,
  ) {}

  private get viaEvolution(): boolean {
    return this.env.get('WHATSAPP_PROVIDER') === 'evolution';
  }

  private instancia(userId: string): string {
    return EvolutionService.instanceName({ type: 'USUARIO', id: userId });
  }

  @Get('status')
  @ApiOperation({ summary: 'Status do meu WhatsApp pessoal (incluindo QR quando pendente)' })
  status(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    if (this.viaEvolution) return this.evolution.estadoComQr(this.instancia(user.id));
    return this.sessions.statusUsuario(user.id, empresaId);
  }

  @Post('conectar')
  // Throttle: pairing é caro (reset forte + cria instância no Evolution). 12/min
  // POR USUÁRIO (via @ThrottlePerUser na classe) previne loop acidental sem travar
  // reconexão/debug legítimos do rep (5/hora travava quem errava o QR algumas vezes).
  @Throttle({ default: { limit: 12, ttl: seconds(60) } })
  @Audit({ action: 'whatsapp_usuario_conectar', resource: 'integracao' })
  @ApiOperation({
    summary: 'Conecta meu WhatsApp pessoal. Primeira vez retorna QR pra escanear.',
  })
  async conectar(@CurrentUser() user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    if (this.viaEvolution) return this.evolution.conectarOuEstado(this.instancia(user.id));
    return this.sessions.iniciarUsuario(user.id, empresaId);
  }

  @Delete('desconectar')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'whatsapp_usuario_desconectar', resource: 'integracao' })
  @ApiOperation({ summary: 'Desconecta meu WhatsApp pessoal (logout da sessão)' })
  async desconectar(@CurrentUser() user: AuthenticatedUser) {
    this.requireEmpresa(user);
    if (this.viaEvolution)
      await this.evolution.logout(this.instancia(user.id)).catch(() => undefined);
    else await this.sessions.desconectarUsuario(user.id);
    return { ok: true };
  }

  @Delete('resetar')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'whatsapp_usuario_resetar', resource: 'integracao' })
  @ApiOperation({
    summary: 'Apaga credenciais do meu WhatsApp — próxima conexão exige novo QR',
  })
  async resetar(@CurrentUser() user: AuthenticatedUser) {
    this.requireEmpresa(user);
    if (this.viaEvolution)
      await this.evolution.resetarForte(this.instancia(user.id)).catch(() => undefined);
    else await this.sessions.resetarUsuario(user.id);
    return { ok: true };
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }
}
