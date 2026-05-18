import { Body, Controller, Delete, Get, Param, Post, Put, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { upsertMetaSchema, type UpsertMetaDto } from './metas.dto';
import { MetasService } from './metas.service';

@ApiTags('metas')
@Controller('metas')
export class MetasController {
  constructor(private readonly svc: MetasService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user);
  }

  @Get(':id')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'create', resource: 'meta' })
  @UsePipes(new ZodValidationPipe(upsertMetaSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertMetaDto) {
    return this.svc.upsert(user, null, dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'update', resource: 'meta', resourceIdFrom: 'params.id' })
  @UsePipes(new ZodValidationPipe(upsertMetaSchema))
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertMetaDto,
  ) {
    return this.svc.upsert(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'delete', resource: 'meta', resourceIdFrom: 'params.id' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.delete(user, id);
  }
}
