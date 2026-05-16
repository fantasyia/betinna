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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateNotaDto,
  type UpdateNotaDto,
  createNotaSchema,
  updateNotaSchema,
} from './notas-privadas.dto';
import { NotasPrivadasService } from './notas-privadas.service';

@ApiTags('clientes')
@ApiBearerAuth()
@Controller('clientes/:clienteId/notas')
export class NotasPrivadasController {
  constructor(private readonly notas: NotasPrivadasService) {}

  @Get()
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({ summary: 'Lista notas privadas do cliente' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('clienteId') clienteId: string) {
    return this.notas.list(user, clienteId);
  }

  @Post()
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'create_nota', resource: 'cliente', resourceIdFrom: 'params.clienteId' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clienteId') clienteId: string,
    @Body(new ZodValidationPipe(createNotaSchema)) dto: CreateNotaDto,
  ) {
    return this.notas.create(user, clienteId, dto);
  }

  @Patch(':notaId')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({ action: 'update_nota', resource: 'cliente', resourceIdFrom: 'params.clienteId' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clienteId') clienteId: string,
    @Param('notaId') notaId: string,
    @Body(new ZodValidationPipe(updateNotaSchema)) dto: UpdateNotaDto,
  ) {
    return this.notas.update(user, clienteId, notaId, dto);
  }

  @Delete(':notaId')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete_nota', resource: 'cliente', resourceIdFrom: 'params.clienteId' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clienteId') clienteId: string,
    @Param('notaId') notaId: string,
  ): Promise<void> {
    await this.notas.remove(user, clienteId, notaId);
  }
}
