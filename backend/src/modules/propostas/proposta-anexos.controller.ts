import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { BusinessRuleException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { PropostaAnexosService } from './proposta-anexos.service';

/** Tipo mínimo do arquivo do multer (sem depender de @types/multer). */
interface ArquivoMultipart {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * O projeto do cliente, anexado à proposta — é o que ele aprova.
 *
 * Sem pelo menos um anexo, a proposta não gera link de aceite (o gate está no
 * `PropostaAceiteService.gerarLink`, que é por onde saem tanto o e-mail quanto
 * o link que o rep manda no WhatsApp).
 */
@ApiTags('propostas')
@ApiBearerAuth()
@Controller('propostas/:propostaId/anexos')
export class PropostaAnexosController {
  constructor(private readonly anexos: PropostaAnexosService) {}

  @Get()
  @RequirePermissions({ module: 'propostas', action: 'view' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('propostaId') propostaId: string) {
    return this.anexos.list(user, propostaId);
  }

  @Post()
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Projeto do cliente (máx. 20MB — PDF, imagem, planilha, DWG/DXF)',
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @Audit({ action: 'anexar_projeto', resource: 'proposta', resourceIdFrom: 'params.propostaId' })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propostaId') propostaId: string,
    @UploadedFile() file: ArquivoMultipart | undefined,
  ) {
    if (!file) throw new BusinessRuleException('Nenhum arquivo enviado');
    return this.anexos.upload(user, propostaId, {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    });
  }

  @Get(':anexoId/download')
  @RequirePermissions({ module: 'propostas', action: 'view' })
  @ApiOperation({ summary: 'Link assinado (1h) — o bucket é privado.' })
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propostaId') propostaId: string,
    @Param('anexoId') anexoId: string,
  ) {
    return this.anexos.download(user, propostaId, anexoId);
  }

  @Delete(':anexoId')
  @RequirePermissions({ module: 'propostas', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'remover_projeto', resource: 'proposta', resourceIdFrom: 'params.propostaId' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propostaId') propostaId: string,
    @Param('anexoId') anexoId: string,
  ): Promise<void> {
    await this.anexos.remove(user, propostaId, anexoId);
  }
}
