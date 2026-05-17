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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Throttle, seconds } from '@nestjs/throttler';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type BulkUpsertCatalogoDto,
  type SetMarkupGlobalDto,
  type ShareCatalogDto,
  type UpsertCatalogoItemDto,
  bulkUpsertCatalogoSchema,
  setMarkupGlobalSchema,
  shareCatalogSchema,
  upsertCatalogoItemSchema,
} from './catalogo.dto';
import { CatalogoService } from './catalogo.service';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get()
  @RequirePermissions({ module: 'catalogo', action: 'view' })
  @ApiOperation({ summary: 'Catálogo personalizado do rep autenticado' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.catalogo.listMyCatalog(user);
  }

  @Put('item')
  @RequirePermissions({ module: 'catalogo', action: 'create' })
  @Audit({ action: 'upsert_catalog_item', resource: 'catalogo_rep' })
  @ApiOperation({ summary: 'Adiciona/atualiza produto no catálogo do rep' })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(upsertCatalogoItemSchema)) dto: UpsertCatalogoItemDto,
  ) {
    return this.catalogo.upsertItem(user, dto);
  }

  @Post('bulk')
  @RequirePermissions({ module: 'catalogo', action: 'create' })
  @Audit({ action: 'bulk_upsert_catalog', resource: 'catalogo_rep' })
  bulk(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(bulkUpsertCatalogoSchema)) dto: BulkUpsertCatalogoDto,
  ) {
    return this.catalogo.bulkUpsert(user, dto);
  }

  @Put('markup-global')
  @RequirePermissions({ module: 'catalogo', action: 'edit' })
  @Audit({ action: 'set_markup_global', resource: 'catalogo_rep' })
  @ApiOperation({ summary: 'Aplica markup % a todos os itens do catálogo do rep' })
  setMarkupGlobal(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setMarkupGlobalSchema)) dto: SetMarkupGlobalDto,
  ) {
    return this.catalogo.setMarkupGlobal(user, dto);
  }

  @Delete('item/:produtoId')
  @RequirePermissions({ module: 'catalogo', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'remove_catalog_item', resource: 'catalogo_rep' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('produtoId') produtoId: string,
  ): Promise<void> {
    await this.catalogo.removeItem(user, produtoId);
  }

  @Delete()
  @RequirePermissions({ module: 'catalogo', action: 'delete' })
  @Audit({ action: 'clear_catalog', resource: 'catalogo_rep' })
  @ApiOperation({ summary: 'Limpa todo o catálogo do rep' })
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.catalogo.clear(user);
  }

  @Get('preview')
  @RequirePermissions({ module: 'catalogo', action: 'view' })
  @ApiOperation({
    summary: 'Preview do catálogo aplicado a um cliente (preço negociado + markup do rep)',
  })
  preview(@CurrentUser() user: AuthenticatedUser, @Query('clienteId') clienteId: string) {
    return this.catalogo.previewParaCliente(user, clienteId);
  }

  @Post('share')
  @RequirePermissions({ module: 'catalogo', action: 'edit' })
  @Audit({ action: 'share_catalog', resource: 'catalogo_rep' })
  @ApiOperation({ summary: 'Compartilha catálogo com cliente (gera token JWT 7d)' })
  share(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(shareCatalogSchema)) dto: ShareCatalogDto,
  ) {
    return this.catalogo.shareWithClient(user, dto);
  }

  /**
   * Endpoint público — cliente acessa preview via link compartilhado.
   * Sem auth. Token JWT signed valida; falha = 401.
   * Throttle 30/min por IP pra evitar brute force de tokens.
   */
  @Public()
  @Get('share/:token')
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  @ApiOperation({
    summary: 'Acessa preview do catálogo via token público (sem auth). TTL ~7 dias.',
  })
  acessarShare(@Param('token') token: string) {
    return this.catalogo.resolverShareToken(token);
  }
}
