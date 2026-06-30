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
  type CreateKnowledgeDocumentoDto,
  type CreateKnowledgeDto,
  type ListKnowledgeDto,
  type UpdateKnowledgeDocumentoDto,
  type UpdateKnowledgeDto,
  createKnowledgeDocumentoSchema,
  createKnowledgeSchema,
  listKnowledgeSchema,
  updateKnowledgeDocumentoSchema,
  updateKnowledgeSchema,
} from './knowledge.dto';
import { KnowledgeDocumentoService } from './knowledge-documento.service';
import { KnowledgeService } from './knowledge.service';

/**
 * Base de conhecimento da empresa (RAG). Leitura = qualquer usuário autenticado;
 * mutações = ADMIN/DIRECTOR (mesmo padrão de @Roles dos materiais).
 */
@ApiTags('conhecimento')
@ApiBearerAuth()
@Controller('conhecimento')
export class KnowledgeController {
  constructor(
    private readonly service: KnowledgeService,
    private readonly documentos: KnowledgeDocumentoService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista os chunks de conhecimento da empresa' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listKnowledgeSchema)) query: ListKnowledgeDto,
  ) {
    return this.service.list(user, query);
  }

  // ─── Documentos (PDF/DOCX/TXT) — rotas ANTES do @Get(':id') pra não colidir ───

  @Get('documentos')
  @ApiOperation({ summary: 'Lista os documentos anexados à base de conhecimento' })
  listarDocumentos(@CurrentUser() user: AuthenticatedUser) {
    return this.documentos.listar(user);
  }

  @Post('documento')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'create', resource: 'conhecimento-documento' })
  @ApiOperation({ summary: 'Anexa um documento (extrai texto + indexa pra busca)' })
  criarDocumento(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createKnowledgeDocumentoSchema)) dto: CreateKnowledgeDocumentoDto,
  ) {
    return this.documentos.criar(user, dto);
  }

  @Patch('documento/:id')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'update', resource: 'conhecimento-documento', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Edita título / flag de envio de um documento' })
  atualizarDocumento(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateKnowledgeDocumentoSchema)) dto: UpdateKnowledgeDocumentoDto,
  ) {
    return this.documentos.atualizar(user, id, dto);
  }

  @Delete('documento/:id')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'conhecimento-documento', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Remove um documento (e seus trechos indexados)' })
  async removerDocumento(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.documentos.remover(user, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um chunk' })
  findById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findById(user, id);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'create', resource: 'conhecimento' })
  @ApiOperation({ summary: 'Cria um chunk de conhecimento' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createKnowledgeSchema)) dto: CreateKnowledgeDto,
  ) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'update', resource: 'conhecimento', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Edita um chunk' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateKnowledgeSchema)) dto: UpdateKnowledgeDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'conhecimento', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Remove um chunk' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.service.remove(user, id);
  }
}
