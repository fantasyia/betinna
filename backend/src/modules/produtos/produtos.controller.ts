import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type ListProdutosDto, listProdutosSchema } from './produtos.dto';
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

  // ─── ESCRITA REMOVIDA: produto se edita NO ERP ─────────────────────
  //
  // Regra do Léo (27/08): "quem edita produto é só o ERP, e o ERP manda pro
  // app — NEM O DIRETOR, NEM O ADMIN devem editar produto pelo app".
  //
  // Não é preferência de UX, é integridade: com escrita nos dois lados alguém
  // muda o preço aqui, o próximo sync sobrescreve, e ninguém entende por quê.
  // O app espelha o catálogo; o ERP manda.
  //
  // As rotas de criar/editar/estoque/ativar/excluir foram REMOVIDAS em vez de
  // escondidas na tela: gate de UI não impede chamada direta à API, e era esse
  // o pedido. Quem escreve em Produto agora é só o sync do Tiny.
}
