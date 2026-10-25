import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { KitsService } from './kits.service';

const listarSchema = z.object({
  busca: z.string().max(80).optional(),
  produto: z.string().max(120).optional(),
  semComposicao: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

/** Kits dos marketplaces no ERP — fora da vitrine (25/10). */
@ApiTags('kits')
@ApiBearerAuth()
@Controller('kits')
export class KitsController {
  constructor(private readonly svc: KitsService) {}

  @Get()
  @ApiOperation({ summary: 'Kits dos marketplaces com SKU, secundário e situação no Magis5' })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarSchema)) q: z.infer<typeof listarSchema>,
  ) {
    return this.svc.listar(user, { ...q, semComposicao: q.semComposicao === 'true' });
  }

  @Get('itens/:id')
  @ApiOperation({ summary: 'Composição de um tamanho do kit (peças que ele consome)' })
  item(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.item(user, id);
  }
}
