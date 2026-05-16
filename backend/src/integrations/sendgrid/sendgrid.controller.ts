import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type SendGridTestDto, sendgridTestSchema } from './sendgrid.dto';
import { SendGridService } from './sendgrid.service';

@ApiTags('integracoes/sendgrid')
@ApiBearerAuth()
@Controller('integracoes/sendgrid')
export class SendGridController {
  constructor(private readonly sendgrid: SendGridService) {}

  @Post('test-send')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'sendgrid_test_send', resource: 'integracao' })
  @ApiOperation({
    summary: 'Envia um e-mail de teste usando as credenciais SendGrid do usuário atual',
  })
  async testSend(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(sendgridTestSchema)) dto: SendGridTestDto,
  ) {
    return this.sendgrid.enviar(user.id, dto);
  }
}
