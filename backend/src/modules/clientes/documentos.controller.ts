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
import { DocumentosService } from './documentos.service';

/** Tipo mínimo do arquivo enviado via multer (sem depender de @types/multer) */
interface UploadedFileBuffer {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('clientes')
@ApiBearerAuth()
@Controller('clientes/:clienteId/documentos')
export class DocumentosController {
  constructor(private readonly docs: DocumentosService) {}

  @Get()
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({ summary: 'Lista documentos anexados ao cliente' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('clienteId') clienteId: string) {
    return this.docs.list(user, clienteId);
  }

  @Post()
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Arquivo a anexar (máx. 10MB, PDF/img/xls/doc/csv)',
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @Audit({ action: 'upload_documento', resource: 'cliente', resourceIdFrom: 'params.clienteId' })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clienteId') clienteId: string,
    @UploadedFile() file: UploadedFileBuffer | undefined,
  ) {
    if (!file) throw new BusinessRuleException('Nenhum arquivo enviado');
    return this.docs.upload(user, clienteId, {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    });
  }

  @Get(':docId/download')
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @Audit({ action: 'download_documento', resource: 'cliente', resourceIdFrom: 'params.clienteId' })
  @ApiOperation({ summary: 'Gera URL assinada para download (expira em 1h)' })
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clienteId') clienteId: string,
    @Param('docId') docId: string,
  ) {
    return this.docs.download(user, clienteId, docId);
  }

  @Delete(':docId')
  @RequirePermissions({ module: 'clientes', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete_documento', resource: 'cliente', resourceIdFrom: 'params.clienteId' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clienteId') clienteId: string,
    @Param('docId') docId: string,
  ): Promise<void> {
    await this.docs.remove(user, clienteId, docId);
  }
}
