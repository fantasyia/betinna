import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type BulkUpsertPrecoEspecialDto,
  type UpsertPrecoEspecialDto,
  bulkUpsertPrecoEspecialSchema,
  upsertPrecoEspecialSchema,
} from './precos-especiais.dto';
import { PrecosEspeciaisService } from './precos-especiais.service';

@ApiTags('clientes')
@ApiBearerAuth()
@Controller('clientes/:clienteId/precos-especiais')
export class PrecosEspeciaisController {
  constructor(private readonly precos: PrecosEspeciaisService) {}

  @Get()
  @RequirePermissions({ module: 'clientes', action: 'view' })
  @ApiOperation({ summary: 'Lista preços negociados de um cliente' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('clienteId') clienteId: string) {
    return this.precos.list(user, clienteId);
  }

  @Put()
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({
    action: 'upsert_preco_especial',
    resource: 'cliente',
    resourceIdFrom: 'params.clienteId',
  })
  @ApiOperation({ summary: 'Cria ou atualiza um preço especial' })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clienteId') clienteId: string,
    @Body(new ZodValidationPipe(upsertPrecoEspecialSchema)) dto: UpsertPrecoEspecialDto,
  ) {
    return this.precos.upsert(user, clienteId, dto);
  }

  @Post('bulk')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @Audit({
    action: 'bulk_upsert_preco_especial',
    resource: 'cliente',
    resourceIdFrom: 'params.clienteId',
  })
  @ApiOperation({ summary: 'Upsert em massa (útil pra sync OMIE)' })
  bulk(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clienteId') clienteId: string,
    @Body(new ZodValidationPipe(bulkUpsertPrecoEspecialSchema))
    dto: BulkUpsertPrecoEspecialDto,
  ) {
    return this.precos.bulkUpsert(user, clienteId, dto);
  }

  @Delete(':produtoId')
  @RequirePermissions({ module: 'clientes', action: 'edit' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({
    action: 'delete_preco_especial',
    resource: 'cliente',
    resourceIdFrom: 'params.clienteId',
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clienteId') clienteId: string,
    @Param('produtoId') produtoId: string,
  ): Promise<void> {
    await this.precos.remove(user, clienteId, produtoId);
  }
}
