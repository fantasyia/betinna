import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { UserRole } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { PermissionsService } from './permissions.service';

const updatePermissionSchema = z.object({
  modulo: z.string().min(1),
  podeVer: z.boolean(),
  podeEditar: z.boolean(),
});

@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get(':role')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Lista permissões consolidadas de um papel' })
  async listByRole(@Param('role') role: UserRole) {
    return this.permissions.listForRole(role);
  }

  @Put(':role')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Atualiza permissão de um papel para um módulo' })
  async update(
    @Param('role') role: UserRole,
    @Body(new ZodValidationPipe(updatePermissionSchema))
    body: z.infer<typeof updatePermissionSchema>,
  ) {
    await this.permissions.upsert(role, body.modulo, body.podeVer, body.podeEditar);
    return { ok: true };
  }
}
