import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  forwardRef,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateBotPromptDto,
  type ListBotPromptsDto,
  type UpdateBotPromptDto,
  createBotPromptSchema,
  listBotPromptsSchema,
  updateBotPromptSchema,
} from './bot-prompts.dto';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { MullerBotService } from '@modules/mullerbot/mullerbot.service';
import { BotPromptsService } from './bot-prompts.service';

/**
 * Biblioteca de prompts do bot (orquestração Fase A).
 * Config de IA da empresa → DIRECTOR (ADMIN como override de suporte, D48).
 * REP também entra — mas o SERVICE o prende à biblioteca PESSOAL dele
 * (escopoDe): lista, cria e edita só os prompts do bot pessoal, nunca os da
 * empresa que os fluxos usam.
 */
@ApiTags('bot-prompts')
@ApiBearerAuth()
@Controller('mullerbot/prompts')
@Roles('ADMIN', 'DIRECTOR', 'REP')
export class BotPromptsController {
  constructor(
    private readonly prompts: BotPromptsService,
    @Inject(forwardRef(() => MullerBotService))
    private readonly bot: MullerBotService,
  ) {}

  /**
   * Valida o `modelo` contra a lista VIVA da OpenAI (a mesma do dropdown).
   *
   * Só barra quando a lista veio de verdade (`fonte='openai'`): se a chave não
   * tem permissão de `/models` ou a rede falhou, recusar seria injusto — o
   * modelo pode ser perfeitamente válido e a gente só não conseguiu conferir.
   *
   * O erro LISTA os modelos aceitos: sem isso, quem edita por API/MCP não tem
   * como descobrir os nomes válidos a não ser chutando.
   */
  private async validarModelo(user: AuthenticatedUser, modelo?: string): Promise<void> {
    const alvo = modelo?.trim();
    if (!alvo) return;
    const { modelos, fonte } = await this.bot.listarModelos(user);
    if (fonte === 'openai' && !modelos.includes(alvo)) {
      throw new BusinessRuleException(
        `Modelo "${alvo}" não existe na conta OpenAI da empresa. ` +
          `Modelos disponíveis: ${modelos.slice(0, 8).join(', ')}${modelos.length > 8 ? '…' : ''}`,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'Lista os prompts do bot (escopo: empresa ativa)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listBotPromptsSchema)) query: ListBotPromptsDto,
  ) {
    return this.prompts.list(user, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.prompts.findById(user, id);
  }

  @Post()
  @Audit({ action: 'create', resource: 'bot_prompt', resourceIdFrom: 'response.id' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createBotPromptSchema)) dto: CreateBotPromptDto,
  ) {
    await this.validarModelo(user, dto.modelo);
    return this.prompts.create(user, dto);
  }

  @Patch(':id')
  @Audit({ action: 'update', resource: 'bot_prompt', resourceIdFrom: 'params.id' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBotPromptSchema)) dto: UpdateBotPromptDto,
  ) {
    await this.validarModelo(user, dto.modelo);
    return this.prompts.update(user, id, dto);
  }

  @Patch(':id/padrao')
  @Audit({ action: 'update', resource: 'bot_prompt', resourceIdFrom: 'params.id' })
  definirPadrao(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.prompts.definirPadrao(user, id);
  }

  @Get(':id/versoes')
  @ApiOperation({ summary: 'Histórico de versões do prompt (rollback)' })
  versoes(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.prompts.listarVersoes(user, id);
  }

  @Post(':id/rollback/:versao')
  @Audit({ action: 'rollback', resource: 'bot_prompt', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Restaura uma versão antiga do prompt' })
  rollback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('versao') versao: string,
  ) {
    return this.prompts.rollback(user, id, Number(versao));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'bot_prompt', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.prompts.remove(user, id);
  }
}
