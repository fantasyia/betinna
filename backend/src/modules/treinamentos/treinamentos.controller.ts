import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '@shared/decorators/audit.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CreateTreinamentoDto,
  type ListTreinamentosDto,
  type UpdateTreinamentoDto,
  createTreinamentoSchema,
  listTreinamentosSchema,
  updateTreinamentoSchema,
} from './treinamentos.dto';
import { TreinamentosService } from './treinamentos.service';

/**
 * Treinamentos internos.
 *
 * **Ler é de todo mundo, escrever é da gestão.** O treinamento existe pra ser
 * assistido por qualquer funcionário — rep, SAC, gerente — então a listagem não
 * pede permissão nenhuma além de estar logado.
 *
 * 📌 Usa `@Roles` na escrita em vez de módulo novo na matriz de permissões de
 * propósito: módulo novo nasce SEM ser semeado, e permissão não semeada dá 403
 * pra todo mundo que não é ADMIN. Seria uma porta nova pra alguém esquecer de
 * abrir, num recurso que não precisa desse grão.
 */
@ApiTags('treinamentos')
@ApiBearerAuth()
@Controller('treinamentos')
export class TreinamentosController {
  constructor(private readonly treinamentos: TreinamentosService) {}

  @Get()
  @ApiOperation({ summary: 'Os vídeos de treinamento da empresa, na ordem.' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listTreinamentosSchema)) query: ListTreinamentosDto,
  ) {
    return this.treinamentos.list(user, query);
  }

  /**
   * Cadastra um vídeo.
   *
   * O corpo aceita o link em qualquer forma (página, encurtado, `<iframe>`) — o
   * DTO normaliza pro ID e RECUSA o que não der pra identificar, porque um ID
   * errado só aparece como "vídeo indisponível" na frente do funcionário.
   */
  @Post()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'create', resource: 'treinamento', resourceIdFrom: 'response.id' })
  @ApiOperation({ summary: 'Cadastra um vídeo de treinamento. **DIRETOR/ADMIN**.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTreinamentoSchema)) dto: CreateTreinamentoDto,
  ) {
    return this.treinamentos.create(user, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'update', resource: 'treinamento', resourceIdFrom: 'params.id' })
  @ApiOperation({ summary: 'Edita título, descrição, ordem, categoria ou o vídeo.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTreinamentoSchema)) dto: UpdateTreinamentoDto,
  ) {
    return this.treinamentos.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'delete', resource: 'treinamento', resourceIdFrom: 'params.id' })
  @ApiOperation({
    summary: 'Apaga o treinamento. Pra só tirar do ar, use PATCH com ativo=false.',
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.treinamentos.remove(user, id);
  }
}
