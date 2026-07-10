import {
  Body,
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
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ValidationException } from '@shared/errors/app-exception';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAnexosService } from './kanban-anexos.service';
import { KanbanComentariosService } from './kanban-comentarios.service';
import {
  type CreateComentarioDto,
  createAnexoLinkSchema,
  createComentarioSchema,
} from './kanban.dto';

interface UploadedFileBuffer {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('kanban')
@ApiBearerAuth()
@Controller('kanban')
export class KanbanComentariosController {
  constructor(
    private readonly comentarios: KanbanComentariosService,
    private readonly anexos: KanbanAnexosService,
  ) {}

  // ─── Comentários ────────────────────────────────────────────────────

  @Post('cards/:id/comentarios')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @Audit({ action: 'comment', resource: 'kanban_card', resourceIdFrom: 'params.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') cardId: string,
    @Body(new ZodValidationPipe(createComentarioSchema)) dto: CreateComentarioDto,
  ) {
    return this.comentarios.create(user, cardId, dto);
  }

  @Delete('comentarios/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Exclui comentário (só autor ou admin)' })
  @Audit({ action: 'delete', resource: 'kanban_comentario', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.comentarios.remove(user, id);
  }

  // ─── Anexos ─────────────────────────────────────────────────────────

  @Post('cards/:id/anexos')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Anexa ARQUIVO (multipart "file") ou LINK (JSON { nome, url })',
  })
  @Audit({ action: 'attach', resource: 'kanban_card', resourceIdFrom: 'params.id' })
  createAnexo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') cardId: string,
    @UploadedFile() file: UploadedFileBuffer | undefined,
    @Body() body: unknown,
  ) {
    if (file) {
      return this.anexos.uploadArquivo(user, cardId, {
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      });
    }
    // Sem arquivo → anexo tipo LINK validado via Zod
    const parsed = createAnexoLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        'Envie um arquivo (multipart "file") ou um link ({ nome, url })',
      );
    }
    return this.anexos.createLink(user, cardId, parsed.data);
  }

  @Get('anexos/:id/link')
  @RequirePermissions({ module: 'quadros', action: 'view' })
  @ApiOperation({ summary: 'URL do anexo (signed 1h pra arquivo; direta pra link)' })
  gerarLink(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.anexos.gerarLink(user, id);
  }

  @Delete('anexos/:id')
  @RequirePermissions({ module: 'quadros', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'kanban_anexo', resourceIdFrom: 'params.id' })
  async removeAnexo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.anexos.remove(user, id);
  }
}
