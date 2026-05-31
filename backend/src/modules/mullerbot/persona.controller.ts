import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { upsertPersonaSchema, type UpsertPersonaDto } from './persona.dto';
import { MullerBotPersonaService } from './persona.service';

/**
 * Persona MullerBot — DIRECTOR-only (decisão de identidade da marca).
 * ADMIN bypassa pra suporte.
 */
@ApiTags('mullerbot')
@Controller('mullerbot/persona')
export class MullerBotPersonaController {
  constructor(private readonly svc: MullerBotPersonaService) {}

  @Get()
  @ApiOperation({ summary: 'Buscar persona ativa da empresa' })
  async get(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.get(user);
  }

  @Get('preview')
  @ApiOperation({ summary: 'Preview do system prompt compilado' })
  async preview(@CurrentUser() user: AuthenticatedUser) {
    const persona = await this.svc.get(user);
    const systemPromptPreview = await this.svc.compilarSystemPrompt(persona.empresaId);
    return { systemPromptPreview };
  }

  @Put()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'update', resource: 'mullerbot-persona' })
  @ApiOperation({ summary: 'Atualizar persona (DIRECTOR-only)' })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    // Pipe SÓ no body — @UsePipes no método inteiro corrompia o @CurrentUser
    // (validava o user contra o schema da persona e apagava empresaIdAtiva/role).
    @Body(new ZodValidationPipe(upsertPersonaSchema)) dto: UpsertPersonaDto,
  ) {
    return this.svc.upsert(user, dto);
  }

  @Post('reset')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'reset', resource: 'mullerbot-persona' })
  @ApiOperation({ summary: 'Resetar pra default (DIRECTOR-only)' })
  async reset(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.reset(user);
  }
}
