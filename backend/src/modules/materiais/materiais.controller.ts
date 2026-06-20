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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateMaterialDto,
  type ListMateriaisDto,
  type UpdateMaterialDto,
  createMaterialSchema,
  listMateriaisSchema,
  updateMaterialSchema,
} from './materiais.dto';
import { MateriaisService } from './materiais.service';

interface UploadedFileBuffer {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Biblioteca de materiais de venda da empresa. Leitura/link = qualquer usuário
 * autenticado da empresa; mutações = ADMIN/DIRECTOR (decisão: sem matriz de
 * permissão própria, gate por @Roles).
 */
@ApiTags('materiais')
@ApiBearerAuth()
@Controller('materiais')
export class MateriaisController {
  constructor(private readonly materiais: MateriaisService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listMateriaisSchema)) query: ListMateriaisDto,
  ) {
    return this.materiais.list(user, query);
  }

  @Get(':id/link')
  @Audit({ action: 'link_material', resource: 'material', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Gera link expirável (URL assinada, 1h) pra visualizar/compartilhar' })
  link(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.materiais.gerarLink(user, id);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        tipo: { type: 'string' },
        titulo: { type: 'string' },
        descricao: { type: 'string' },
        produtoId: { type: 'string' },
        categoria: { type: 'string' },
        confidencial: { type: 'boolean' },
      },
    },
  })
  @Audit({ action: 'create', resource: 'material', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createMaterialSchema)) dto: CreateMaterialDto,
    @UploadedFile() file: UploadedFileBuffer | undefined,
  ) {
    if (!file) throw new BusinessRuleException('Nenhum arquivo enviado');
    return this.materiais.create(user, dto, {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    });
  }

  @Patch(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'update', resource: 'material', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMaterialSchema)) dto: UpdateMaterialDto,
  ) {
    return this.materiais.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'material', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.materiais.remove(user, id);
  }
}
