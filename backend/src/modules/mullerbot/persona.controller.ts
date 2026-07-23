import { Body, Controller, Get, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { BusinessRuleException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  patchPersonaSchema,
  upsertPersonaSchema,
  type PatchPersonaDto,
  type UpsertPersonaDto,
} from './persona.dto';
import { MullerBotPersonaService } from './persona.service';
import { MullerBotService } from './mullerbot.service';

/**
 * Persona MullerBot — DIRECTOR-only (decisão de identidade da marca).
 * ADMIN bypassa pra suporte.
 */
@ApiTags('mullerbot')
@Controller('mullerbot/persona')
export class MullerBotPersonaController {
  constructor(
    private readonly svc: MullerBotPersonaService,
    private readonly bot: MullerBotService,
  ) {}

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

  @Patch()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'patch', resource: 'mullerbot-persona' })
  @ApiOperation({
    summary:
      'Editar PARCIALMENTE a config do bot (só o que muda) — usado pelo MCP bot_config_atualizar',
  })
  async patch(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(patchPersonaSchema)) dto: PatchPersonaDto,
  ) {
    // Valida o modelo contra a lista VIVA da OpenAI (a mesma do dropdown). Só barra
    // quando a lista veio de verdade (fonte='openai') — se a OpenAI não pôde ser
    // consultada (chave sem permissão de /models, rede), NÃO bloqueia: seria injusto
    // recusar um modelo válido só porque não deu pra listar. `null` limpa o modelo
    // (volta pro padrão do servidor), não precisa validar.
    if (dto.modelo != null && dto.modelo.trim()) {
      const { modelos, fonte } = await this.bot.listarModelos(user);
      if (fonte === 'openai' && !modelos.includes(dto.modelo.trim())) {
        throw new BusinessRuleException(
          `Modelo "${dto.modelo.trim()}" não existe na conta OpenAI da empresa. ` +
            `Modelos disponíveis: ${modelos.slice(0, 8).join(', ')}${modelos.length > 8 ? '…' : ''}`,
        );
      }
    }
    return this.svc.patch(user, dto);
  }

  @Post('reset')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'reset', resource: 'mullerbot-persona' })
  @ApiOperation({ summary: 'Resetar pra default (DIRECTOR-only)' })
  async reset(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.reset(user);
  }
}
