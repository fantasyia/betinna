import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { OmieClientService } from './omie-client.service';
import { OmieClientesService } from './omie-clientes.service';
import { OmieProdutosService } from './omie-produtos.service';

const syncQuerySchema = z.object({
  modo: z.enum(['incremental', 'completo']).default('incremental'),
});
type SyncQueryDto = z.infer<typeof syncQuerySchema>;

@ApiTags('integracoes/omie')
@ApiBearerAuth()
@Controller('integracoes/omie')
export class OmieController {
  constructor(
    private readonly omieClient: OmieClientService,
    private readonly clientesSvc: OmieClientesService,
    private readonly produtosSvc: OmieProdutosService,
  ) {}

  @Get('status')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Status da integração OMIE (modo demo, configurada, último sync)' })
  status(@CurrentUser() user: AuthenticatedUser) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return {
      demoMode: this.omieClient.isDemoMode(),
      empresaId: user.empresaIdAtiva,
    };
  }

  @Post('sync/clientes')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'sync_clientes_omie', resource: 'integracao' })
  @ApiOperation({
    summary:
      'Sincroniza clientes do OMIE. modo=incremental (default) só importa alterados; modo=completo força tudo.',
  })
  @ApiQuery({ name: 'modo', enum: ['incremental', 'completo'], required: false })
  syncClientes(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(syncQuerySchema)) query: SyncQueryDto,
  ) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return this.clientesSvc.sync(user.empresaIdAtiva, { modo: query.modo });
  }

  @Post('sync/produtos')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'sync_produtos_omie', resource: 'integracao' })
  @ApiOperation({
    summary:
      'Sincroniza produtos do OMIE. modo=incremental (default) só importa alterados; modo=completo força tudo.',
  })
  @ApiQuery({ name: 'modo', enum: ['incremental', 'completo'], required: false })
  syncProdutos(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(syncQuerySchema)) query: SyncQueryDto,
  ) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return this.produtosSvc.sync(user.empresaIdAtiva, { modo: query.modo });
  }

  @Post('sync/forcar')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'sync_forcar_omie', resource: 'integracao' })
  @ApiOperation({
    summary: 'Força sincronização COMPLETA de clientes + produtos (ignora último sync).',
  })
  async forcarTudo(@CurrentUser() user: AuthenticatedUser) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    const empresaId = user.empresaIdAtiva;
    const [clientes, produtos] = await Promise.all([
      this.clientesSvc.sync(empresaId, { modo: 'completo' }),
      this.produtosSvc.sync(empresaId, { modo: 'completo' }),
    ]);
    return { clientes, produtos };
  }
}
