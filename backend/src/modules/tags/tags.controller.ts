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
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateTagDto,
  type ListTagsDto,
  type UpdateTagDto,
  createTagSchema,
  listTagsSchema,
  updateTagSchema,
} from './tags.dto';
import { TagsService } from './tags.service';

@ApiTags('tags')
@ApiBearerAuth()
@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({ summary: 'Lista tags com contagem de clientes (escopo: empresa ativa)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listTagsSchema)) query: ListTagsDto,
  ) {
    return this.tags.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'clientes', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tags.findById(user, id);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'create', resource: 'tag', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTagSchema)) dto: CreateTagDto,
  ) {
    return this.tags.create(user, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'update', resource: 'tag', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTagSchema)) dto: UpdateTagDto,
  ) {
    return this.tags.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'tag', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.tags.remove(user, id);
  }
}
