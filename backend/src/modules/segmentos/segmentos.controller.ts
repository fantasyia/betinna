import { Body, Controller, Delete, Get, Param, Post, Put, Query, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  previewSchema,
  upsertSegmentoSchema,
  type PreviewDto,
  type UpsertSegmentoDto,
} from './segmentos.dto';
import { SegmentosService } from './segmentos.service';

@ApiTags('segmentos')
@Controller('segmentos')
export class SegmentosController {
  constructor(private readonly svc: SegmentosService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user);
  }

  @Get(':id')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Get(':id/clientes')
  listarClientes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listarClientes(user, id, limit ? Number(limit) : 50);
  }

  @Post('preview')
  @UsePipes(new ZodValidationPipe(previewSchema))
  preview(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreviewDto) {
    return this.svc.preview(user, dto.regras, dto.limit);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'create', resource: 'segmento' })
  @UsePipes(new ZodValidationPipe(upsertSegmentoSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertSegmentoDto) {
    return this.svc.upsert(user, null, dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'update', resource: 'segmento', resourceIdFrom: 'params.id' })
  @UsePipes(new ZodValidationPipe(upsertSegmentoSchema))
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertSegmentoDto,
  ) {
    return this.svc.upsert(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'delete', resource: 'segmento', resourceIdFrom: 'params.id' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.delete(user, id);
  }
}
