import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { PushService } from './push.service';

const inscricaoSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(5).max(100) }),
  userAgent: z.string().max(300).optional(),
});
type InscricaoDto = z.infer<typeof inscricaoSchema>;
const saidaSchema = z.object({ endpoint: z.string().url().max(1000) });

@ApiTags('push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('chave')
  @ApiOperation({ summary: 'Chave pública VAPID e quantos aparelhos o usuário tem inscritos' })
  async chave(@CurrentUser() user: AuthenticatedUser) {
    return { chave: this.push.chavePublica(), aparelhos: await this.push.aparelhosDo(user.id) };
  }

  @Post('inscrever')
  @HttpCode(204)
  @ApiOperation({ summary: 'Inscreve ESTE aparelho pra receber notificações' })
  async inscrever(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(inscricaoSchema)) dto: InscricaoDto,
  ) {
    await this.push.inscrever(user.id, user.empresaIdAtiva ?? null, {
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: dto.userAgent,
    });
  }

  @Post('sair')
  @HttpCode(204)
  @ApiOperation({ summary: 'Para de receber neste aparelho' })
  async sair(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(saidaSchema)) dto: { endpoint: string },
  ) {
    await this.push.desinscrever(user.id, dto.endpoint);
  }

  @Post('teste')
  @ApiOperation({ summary: 'Manda um push de teste pros aparelhos do próprio usuário' })
  async teste(@CurrentUser() user: AuthenticatedUser) {
    const entregues = await this.push.enviar([user.id], {
      titulo: 'Betinna',
      corpo: 'Notificações ligadas neste aparelho ✅',
      url: '/perfil',
      tag: 'teste',
    });
    return { entregues, ativo: this.push.ativo() };
  }
}
