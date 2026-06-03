import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
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
import { BotPromptsService } from './bot-prompts.service';

/**
 * Biblioteca de prompts do bot (orquestração Fase A).
 * Config de IA da empresa → DIRECTOR (ADMIN como override de suporte, D48).
 */
@ApiTags('bot-prompts')
@ApiBearerAuth()
@Controller('mullerbot/prompts')
@Roles('ADMIN', 'DIRECTOR')
export class BotPromptsController {
  constructor(private readonly prompts: BotPromptsService) {}

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
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createBotPromptSchema)) dto: CreateBotPromptDto,
  ) {
    return this.prompts.create(user, dto);
  }

  @Patch(':id')
  @Audit({ action: 'update', resource: 'bot_prompt', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBotPromptSchema)) dto: UpdateBotPromptDto,
  ) {
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
