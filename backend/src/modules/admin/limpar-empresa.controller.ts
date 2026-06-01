import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { LimparEmpresaService } from './limpar-empresa.service';

/**
 * Limpeza operacional de UMA empresa ("começar do zero") — ADMIN-only.
 *
 * Roda no servidor (banco que o app usa de verdade). Apaga o dado operacional
 * da empresa ativa do usuário, mantendo a estrutura. Exige confirmacao="LIMPAR".
 */
const limparSchema = z.object({
  confirmacao: z.string().min(1),
});

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/limpar-empresa')
export class LimparEmpresaController {
  constructor(private readonly svc: LimparEmpresaService) {}

  @Post()
  @HttpCode(200)
  @Audit({ action: 'limpar_empresa', resource: 'admin' })
  @ApiOperation({
    summary: 'Apaga o dado operacional da empresa ativa. Exige confirmacao="LIMPAR".',
  })
  limpar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(limparSchema)) body: z.infer<typeof limparSchema>,
  ) {
    const empresaId = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!empresaId) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.svc.limpar(empresaId, body.confirmacao);
  }
}
