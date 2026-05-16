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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type ChangeAmostraStatusDto,
  type CreateAmostraDto,
  type ListAmostrasDto,
  type UpdateAmostraDto,
  changeAmostraStatusSchema,
  createAmostraSchema,
  listAmostrasSchema,
  updateAmostraSchema,
} from './amostras.dto';
import { AmostrasService } from './amostras.service';

@ApiTags('amostras')
@ApiBearerAuth()
@Controller('amostras')
export class AmostrasController {
  constructor(private readonly amostras: AmostrasService) {}

  @Get()
  @RequirePermissions({ module: 'amostras', action: 'view' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listAmostrasSchema)) query: ListAmostrasDto,
  ) {
    return this.amostras.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'amostras', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.amostras.findById(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'amostras', action: 'create' })
  @Audit({ action: 'create', resource: 'amostra', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAmostraSchema)) dto: CreateAmostraDto,
  ) {
    return this.amostras.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'amostras', action: 'edit' })
  @Audit({ action: 'update', resource: 'amostra', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAmostraSchema)) dto: UpdateAmostraDto,
  ) {
    return this.amostras.update(user, id, dto);
  }

  @Put(':id/status')
  @RequirePermissions({ module: 'amostras', action: 'edit' })
  @Audit({ action: 'change_status', resource: 'amostra', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Atualiza status (ex: ENVIADA → CONVERTIDA)' })
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeAmostraStatusSchema)) dto: ChangeAmostraStatusDto,
  ) {
    return this.amostras.changeStatus(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'amostras', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'amostra', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.amostras.remove(user, id);
  }
}
