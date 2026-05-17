import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';

/**
 * Audit log viewer — ADMIN only (sensitive: contém ações cross-tenant).
 *
 * Endpoints:
 *  - GET /audit?page=1&limit=50&empresaId=...&usuarioId=...&acao=...&recurso=...&recursoId=...&de=...&ate=...
 *  - GET /audit/:id — detalhes
 *  - GET /audit/recursos — lista valores únicos pra dropdown
 *
 * Uso típico: investigar quem fez o quê em um pedido/cliente/etc.
 *  - "Quem cancelou o pedido PED-0042?" → recurso=pedido, recursoId=<id>
 *  - "Que ações o user X fez ontem?" → usuarioId=X, de=ontem, ate=hoje
 */

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  empresaId: z.string().min(1).optional(),
  usuarioId: z.string().min(1).optional(),
  acao: z.string().min(1).max(80).optional(),
  recurso: z.string().min(1).max(80).optional(),
  recursoId: z.string().min(1).max(80).optional(),
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
});

@ApiTags('audit')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('audit')
export class AuditController {
  constructor(private readonly svc: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista audit logs (ADMIN only). Filtros: empresa, usuário, ação, recurso, período.',
  })
  list(@Query(new ZodValidationPipe(listSchema)) params: z.infer<typeof listSchema>) {
    return this.svc.list(params);
  }

  @Get('recursos')
  @ApiOperation({ summary: 'Lista valores únicos de `recurso` (pra dropdown de filtros)' })
  recursos() {
    return this.svc.listRecursosUnicos();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um audit log' })
  async findById(@Param('id') id: string) {
    const r = await this.svc.findById(id);
    if (!r) throw new NotFoundException(`Audit log ${id} não encontrado`);
    return r;
  }
}
