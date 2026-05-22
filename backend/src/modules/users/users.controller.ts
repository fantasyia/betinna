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
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateUserDto,
  type ListUsersDto,
  type UpdateComissaoPercentualDto,
  type UpdateRepDiscountLimitDto,
  type UpdateUserDto,
  createUserSchema,
  listUsersSchema,
  updateComissaoPercentualSchema,
  updateRepDiscountLimitSchema,
  updateUserSchema,
} from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  @ApiOperation({ summary: 'Lista usuários com filtros (escopo: empresa ativa, exceto ADMIN)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listUsersSchema)) query: ListUsersDto,
  ) {
    return this.users.list(user, query);
  }

  @Get(':id')
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.findById(user, id);
  }

  @Post()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'invite', resource: 'usuario', resourceIdFrom: 'response.id' })
  @ApiOperation({
    summary:
      'Convida um novo usuário (cria no Supabase + envia e-mail). ADMIN pode' +
      ' criar em qualquer empresa; DIRECTOR só na empresa ativa dele e não' +
      ' pode criar ADMIN/DIRECTOR.',
  })
  create(
    @CurrentUser() caller: AuthenticatedUser,
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto,
  ) {
    return this.users.create(caller, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @Audit({ action: 'update', resource: 'usuario', resourceIdFrom: 'params.id' })
  update(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.users.update(caller, id, dto);
  }

  @Put(':id/ativar')
  @Roles('ADMIN')
  @Audit({ action: 'activate', resource: 'usuario', resourceIdFrom: 'params.id' })
  activate(@CurrentUser() caller: AuthenticatedUser, @Param('id') id: string) {
    return this.users.setStatus(caller, id, 'ATIVO');
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'deactivate', resource: 'usuario', resourceIdFrom: 'params.id' })
  async deactivate(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.users.setStatus(caller, id, 'INATIVO');
  }

  @Put(':id/teto-desconto')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'set_discount_limit', resource: 'usuario', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Define o teto de desconto autônomo de um rep. **DIRETOR-only (D46)** — decisão financeira.',
  })
  async setDiscountLimit(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRepDiscountLimitSchema)) dto: UpdateRepDiscountLimitDto,
  ): Promise<{ ok: true }> {
    await this.users.setRepDiscountLimit(caller, id, dto);
    return { ok: true };
  }

  @Put(':id/comissao')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'set_comissao', resource: 'usuario', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary:
      'Define a % de comissão de um REP ou GERENTE. ' +
      'REP: comissão sobre os próprios pedidos. GERENTE: sobre o total de vendas dos REPs sob sua gerência. ' +
      '**DIRETOR-only (D46)** — cláusula contratual.',
  })
  async setComissao(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateComissaoPercentualSchema))
    dto: UpdateComissaoPercentualDto,
  ): Promise<{ ok: true }> {
    await this.users.setComissaoPercentual(caller, id, dto);
    return { ok: true };
  }

  @Post(':id/reenviar-convite')
  @Roles('ADMIN')
  @Audit({ action: 'resend_invite', resource: 'usuario', resourceIdFrom: 'params.id' })
  resendInvite(@CurrentUser() caller: AuthenticatedUser, @Param('id') id: string) {
    return this.users.resendInvite(caller, id);
  }
}
