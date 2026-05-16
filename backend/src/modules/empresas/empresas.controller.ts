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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import {
  type CreateEmpresaDto,
  type ListEmpresasDto,
  type UpdateEmpresaDto,
  createEmpresaSchema,
  listEmpresasSchema,
  updateEmpresaSchema,
} from './empresas.dto';
import { EmpresasService } from './empresas.service';

@ApiTags('empresas')
@ApiBearerAuth()
@Controller('empresas')
export class EmpresasController {
  constructor(private readonly empresas: EmpresasService) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Lista empresas (somente Admin)' })
  list(
    @Query(new ZodValidationPipe(listEmpresasSchema)) query: ListEmpresasDto,
  ) {
    return this.empresas.list(query);
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
  create(
    @Body(new ZodValidationPipe(createEmpresaSchema)) dto: CreateEmpresaDto,
  ) {
    return this.empresas.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @Audit({ action: 'update', resource: 'empresa', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Atualiza uma empresa' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmpresaSchema)) dto: UpdateEmpresaDto,
  ) {
    return this.empresas.update(id, dto);
  }

  @Put(':id/ativar')
  @Roles('ADMIN')
  @Audit({ action: 'activate', resource: 'empresa', resourceIdFrom: 'params.id' })
  activate(@Param('id') id: string) {
    return this.empresas.activate(id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'deactivate', resource: 'empresa', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Desativa uma empresa (soft)' })
  async deactivate(@Param('id') id: string): Promise<void> {
    await this.empresas.deactivate(id);
  }
}
