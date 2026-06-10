import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type PerguntarDto, perguntarSchema } from './mullerbot.dto';
import { MullerBotService } from './mullerbot.service';

@ApiTags('mullerbot')
@ApiBearerAuth()
@Controller('mullerbot')
export class MullerBotController {
  constructor(private readonly bot: MullerBotService) {}

  @Post('perguntar')
  @HttpCode(HttpStatus.OK)
  // Bucket dedicado pra MullerBot: chamada à OpenAI custa $ + latência alta.
  // 30 req/min é generoso pra uso normal, freia abuso/loop.
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  @Audit({ action: 'mullerbot_perguntar', resource: 'mullerbot' })
  @ApiOperation({
    summary:
      'Pergunta com RAG sobre catálogo de produtos. Cache de respostas (sem sessão) e histórico opcional via sessionId.',
  })
  perguntar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(perguntarSchema)) dto: PerguntarDto,
  ) {
    return this.bot.perguntar(user, dto);
  }

  @Get('bot/diagnostico')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({
    summary:
      'Diagnóstico do bot do WhatsApp: verifica a chave OpenAI que o bot usa (empresa ou servidor) e faz ping na OpenAI.',
  })
  diagnosticarBot(@CurrentUser() user: AuthenticatedUser) {
    return this.bot.diagnosticarBot(user.empresaIdAtiva ?? undefined);
  }

  @Get('bot/modelos')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Lista os modelos de chat disponíveis na conta OpenAI do usuário.' })
  listarModelos(@CurrentUser() user: AuthenticatedUser) {
    return this.bot.listarModelos(user);
  }

  @Delete('historico/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Limpa histórico conversacional da sessão' })
  limparHistorico(@CurrentUser() user: AuthenticatedUser, @Param('sessionId') sessionId: string) {
    return this.bot.limparHistorico(user, sessionId);
  }
}
