import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
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
  @Audit({ action: 'mullerbot_perguntar', resource: 'mullerbot' })
  @ApiOperation({
    summary: 'Pergunta com RAG sobre catálogo de produtos (importado do OMIE)',
  })
  perguntar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(perguntarSchema)) dto: PerguntarDto,
  ) {
    return this.bot.perguntar(user, dto);
  }
}
