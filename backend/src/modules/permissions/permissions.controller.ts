import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { UserRole } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '@database/prisma.service';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
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
  constructor(
    private readonly permissions: PermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Permissões EFETIVAS do usuário logado (papel + overrides individuais).
   * Qualquer usuário autenticado — é o que o frontend usa pra montar menu/rotas.
   */
  @Get('me')
  @ApiOperation({ summary: 'Permissões efetivas do usuário logado' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const permissoes = await this.permissions.listEffectiveForUser(user.id, user.role);
    return { role: user.role, permissoes };
  }

  @Get('usuario/:usuarioId')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Permissões efetivas de um usuário (com flag de override)' })
  async listForUser(@CurrentUser() user: AuthenticatedUser, @Param('usuarioId') usuarioId: string) {
    const alvo = await this.assertAlvoGerenciavel(user, usuarioId);
    const permissoes = await this.permissions.listEffectiveForUser(alvo.id, alvo.role);
    return { usuarioId: alvo.id, role: alvo.role, permissoes };
  }

  @Put('usuario/:usuarioId')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Cria/atualiza override de permissão de um usuário para um módulo' })
  async upsertForUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('usuarioId') usuarioId: string,
    @Body(new ZodValidationPipe(updatePermissionSchema))
    body: z.infer<typeof updatePermissionSchema>,
  ) {
    await this.assertAlvoGerenciavel(user, usuarioId);
    await this.permissions.upsertUserOverride(
      usuarioId,
      body.modulo,
      body.podeVer,
      body.podeEditar,
    );
    return { ok: true };
  }

  @Delete('usuario/:usuarioId/:modulo')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Remove override — módulo volta ao padrão do papel' })
  async removeForUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('usuarioId') usuarioId: string,
    @Param('modulo') modulo: string,
  ) {
    await this.assertAlvoGerenciavel(user, usuarioId);
    await this.permissions.removeUserOverride(usuarioId, modulo);
    return { ok: true };
  }

  @Get(':role')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Lista permissões coarse (ver/editar) de um papel' })
  async listByRole(@Param('role') role: UserRole) {
    // Linhas { modulo, podeVer, podeEditar } — shape que a página de permissões consome.
    return this.permissions.listForRoleRows(role);
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

  /**
   * Alvo precisa existir, não ser ADMIN (ADMIN tem bypass — override é inócuo e
   * confundiria o painel) e pertencer à empresa ativa do gestor (DIRECTOR não
   * gerencia usuário de outra empresa; ADMIN cross-tenant passa).
   */
  private async assertAlvoGerenciavel(
    gestor: AuthenticatedUser,
    usuarioId: string,
  ): Promise<{ id: string; role: UserRole }> {
    const alvo = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, role: true, empresas: { select: { empresaId: true } } },
    });
    if (!alvo) throw new NotFoundException('Usuário não encontrado');
    if (alvo.role === 'ADMIN') {
      throw new ForbiddenException('ADMIN tem acesso total — não aceita override de permissão');
    }
    if (gestor.role !== 'ADMIN') {
      const mesmaEmpresa = alvo.empresas.some((e) => e.empresaId === gestor.empresaIdAtiva);
      if (!mesmaEmpresa) throw new ForbiddenException('Usuário não pertence à sua empresa');
    }
    return { id: alvo.id, role: alvo.role };
  }
}
