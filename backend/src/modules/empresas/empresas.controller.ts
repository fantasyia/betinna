import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EmpresaLogoService } from './empresa-logo.service';
import {
  type CreateEmpresaDto,
  type ListEmpresasDto,
  type TenantConfigPatchDto,
  type UpdateEmpresaDto,
  createEmpresaSchema,
  listEmpresasSchema,
  tenantConfigPatchSchema,
  updateEmpresaSchema,
} from './empresas.dto';
import { EmpresasService } from './empresas.service';

/** Tipo mínimo do arquivo enviado via multer (sem depender de @types/multer) */
interface UploadedFileBuffer {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('empresas')
@ApiBearerAuth()
@Controller('empresas')
export class EmpresasController {
  constructor(
    private readonly empresas: EmpresasService,
    private readonly logoService: EmpresaLogoService,
  ) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Lista empresas (somente Admin)' })
  list(@Query(new ZodValidationPipe(listEmpresasSchema)) query: ListEmpresasDto) {
    return this.empresas.list(query);
  }

  @Get('minhas')
  @ApiOperation({
    summary:
      'Lista as empresas que o usuário pode acessar (ADMIN: todas ativas; demais: vinculadas).',
  })
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.empresas.listMine(user);
  }

  @Get('atual')
  @ApiOperation({
    summary:
      'Config da empresa ATIVA (header X-Empresa-Id). Inclui descontos à vista — usado pra preview no front.',
  })
  empresaAtual(@CurrentUser() user: AuthenticatedUser) {
    return this.empresas.empresaAtual(user);
  }

  // ─── ConfiguracaoTenant (no-code Admin Panel) — DEVE vir antes de @Get(':id') ──

  @Get('config')
  @ApiOperation({
    summary: 'ConfiguracaoTenant (no-code) da empresa ativa — regras editáveis pelo Admin Panel.',
  })
  getConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.empresas.getConfig(user);
  }

  @Patch('config')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'update_config', resource: 'empresa' })
  @ApiOperation({ summary: 'Atualiza a config (no-code) da empresa ativa. **DIRETOR/ADMIN**.' })
  patchConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(tenantConfigPatchSchema)) dto: TenantConfigPatchDto,
  ) {
    return this.empresas.patchConfig(user, dto);
  }

  @Get(':id')
  @Roles('ADMIN', 'GERENTE')
  @ApiOperation({ summary: 'Detalhes de uma empresa' })
  findOne(@Param('id', new ParseUUIDPipe({ optional: true })) id: string) {
    return this.empresas.findById(id);
  }

  @Post()
  @Roles('ADMIN')
  @Audit({ action: 'create', resource: 'empresa', resourceIdFrom: 'response.id' })
  @ApiOperation({ summary: 'Cria uma nova empresa (somente Admin)' })
  create(@Body(new ZodValidationPipe(createEmpresaSchema)) dto: CreateEmpresaDto) {
    return this.empresas.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'update', resource: 'empresa', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Atualiza uma empresa. **DIRETOR-only (D46)** — afeta dados fiscais (CNPJ, razão).',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmpresaSchema)) dto: UpdateEmpresaDto,
  ) {
    return this.empresas.update(user, id, dto);
  }

  @Put(':id/ativar')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'activate', resource: 'empresa', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Reativa empresa desativada. **DIRETOR-only (D46)**.' })
  activate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.empresas.activate(user, id);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'deactivate', resource: 'empresa', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Desativa uma empresa (soft). **DIRETOR-only (D46)**.' })
  async deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.empresas.deactivate(user, id);
  }

  // ─── Logo da empresa (v1.5.0) ───────────────────────────────────────────

  @Get(':id/logo')
  @ApiOperation({ summary: 'Retorna signed URL do logo (cache 7 dias)' })
  getLogo(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    // IDOR guard: só logo de empresa vinculada ao usuário. Sem isso, qualquer usuário logado
    // obtinha a signed URL do logo (e a existência) de qualquer tenant. ADMIN é cross-tenant (D48).
    if (user.role !== 'ADMIN' && !user.empresaIds.includes(id)) {
      throw new ForbiddenException('Empresa não vinculada', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.logoService.getSignedUrl(id);
  }

  @Post(':id/logo')
  @Roles('ADMIN', 'DIRECTOR')
  @UseInterceptors(FileInterceptor('logo'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Logo da empresa (PNG/JPG/WebP/SVG, máx. 2MB)',
    schema: {
      type: 'object',
      properties: { logo: { type: 'string', format: 'binary' } },
    },
  })
  @Audit({ action: 'upload_logo', resource: 'empresa', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Faz upload do logo da empresa (substitui o atual)' })
  uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileBuffer | undefined,
  ) {
    if (!file) throw new BusinessRuleException('Nenhum arquivo enviado');
    return this.logoService.upload(user, id, {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    });
  }

  @Delete(':id/logo')
  @Roles('ADMIN', 'DIRECTOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete_logo', resource: 'empresa', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Remove o logo da empresa' })
  async removeLogo(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.logoService.remove(user, id);
  }
}
