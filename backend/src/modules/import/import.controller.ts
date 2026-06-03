import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, minutes } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type ImportClientesDto,
  type ImportLeadsDto,
  type ImportProdutosDto,
  importClientesSchema,
  importLeadsSchema,
  importProdutosSchema,
} from './import.dto';
import { ImportService } from './import.service';

@ApiTags('import')
@ApiBearerAuth()
@Controller('import')
export class ImportController {
  constructor(private readonly svc: ImportService) {}

  @Post('clientes')
  @HttpCode(HttpStatus.OK)
  // Imports são operações pesadas (até 5000 linhas). 5/min por tenant é
  // suficiente pra onboarding sem virar vetor de DoS contra o DB.
  @Throttle({ default: { limit: 5, ttl: minutes(1) } })
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'import_clientes', resource: 'import' })
  @ApiOperation({
    summary: 'Importa clientes via CSV. Match por CNPJ ou email. dryRun=true valida sem persistir.',
  })
  importClientes(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importClientesSchema)) dto: ImportClientesDto,
  ) {
    return this.svc.importarClientes(user, dto);
  }

  @Post('produtos')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: minutes(1) } })
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'import_produtos', resource: 'import' })
  @ApiOperation({
    summary: 'Importa produtos via CSV. Match por SKU. ADMIN/DIRECTOR only.',
  })
  importProdutos(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importProdutosSchema)) dto: ImportProdutosDto,
  ) {
    return this.svc.importarProdutos(user, dto);
  }

  @Post('leads')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: minutes(1) } })
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @Audit({ action: 'import_leads', resource: 'import' })
  @ApiOperation({
    summary:
      'Importa leads em lote (Excel/CSV). Caem no funil/etapa informado. dryRun valida sem persistir.',
  })
  importLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importLeadsSchema)) dto: ImportLeadsDto,
  ) {
    return this.svc.importarLeads(user, dto);
  }
}
