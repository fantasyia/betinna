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
  type AtivarDto,
  type CreateProdutoDto,
  type ListProdutosDto,
  type UpdateEstoqueDto,
  type UpdateProdutoDto,
  ativarSchema,
  createProdutoSchema,
  listProdutosSchema,
  updateEstoqueSchema,
  updateProdutoSchema,
} from './produtos.dto';
import { ProdutosService } from './produtos.service';

@ApiTags('produtos')
@ApiBearerAuth()
@Controller('produtos')
export class ProdutosController {
  constructor(private readonly produtos: ProdutosService) {}

  @Get('facets')
  @RequirePermissions({ module: 'catalogo', action: 'view' })
  @ApiOperation({ summary: 'Valores únicos de linha, categoria e marca (filtros)' })
  facets(@CurrentUser() user: AuthenticatedUser) {
    return this.produtos.facets(user);
  }

  @Get()
  @RequirePermissions({ module: 'catalogo', action: 'view' })
  @ApiOperation({ summary: 'Lista produtos com filtros e paginação' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listProdutosSchema)) query: ListProdutosDto,
  ) {
    return this.produtos.list(user, query);
  }

  @Get(':id')
  @RequirePermissions({ module: 'catalogo', action: 'view' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.produtos.findById(user, id);
  }

  @Post()
  @RequirePermissions({ module: 'catalogo', action: 'create' })
  @Audit({ action: 'create', resource: 'produto', resourceIdFrom: 'response.id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createProdutoSchema)) dto: CreateProdutoDto,
  ) {
    return this.produtos.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions({ module: 'catalogo', action: 'edit' })
  @Audit({ action: 'update', resource: 'produto', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProdutoSchema)) dto: UpdateProdutoDto,
  ) {
    return this.produtos.update(user, id, dto);
  }

  @Put(':id/estoque')
  @RequirePermissions({ module: 'catalogo', action: 'edit' })
  @Audit({ action: 'update_estoque', resource: 'produto', resourceIdFrom: 'params.id' })
  updateEstoque(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEstoqueSchema)) dto: UpdateEstoqueDto,
  ) {
    return this.produtos.updateEstoque(user, id, dto);
  }

  @Put(':id/ativo')
  @RequirePermissions({ module: 'catalogo', action: 'edit' })
  @Audit({ action: 'toggle_ativo', resource: 'produto', resourceIdFrom: 'params.id' })
  setAtivo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ativarSchema)) dto: AtivarDto,
  ) {
    return this.produtos.setAtivo(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions({ module: 'catalogo', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'delete', resource: 'produto', resourceIdFrom: 'params.id' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.produtos.remove(user, id);
  }
}
