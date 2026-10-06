import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type FaccaoDto,
  type FichaDto,
  type PrecosFaccaoDto,
  type RegrasEncaixeDto,
  faccaoSchema,
  fichaSchema,
  precosFaccaoSchema,
  regrasEncaixeSchema,
} from './fichas.dto';
import { FichasService } from './fichas.service';

/**
 * ERP próprio · ficha técnica e facções. Só ADMIN/DIRECTOR e só com
 * `config.erpInterno.ativo` (o service recusa com 422 fora disso).
 */
@ApiTags('erp')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('erp')
export class FichasController {
  constructor(private readonly svc: FichasService) {}

  @Get('fichas')
  @ApiOperation({ summary: 'Grades (modelo × linha) com o custo previsto pela ficha' })
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listar(user);
  }

  @Get('fichas/:modeloLinhaId')
  @ApiOperation({ summary: 'Ficha técnica da grade: insumos, consumo por peça e custo previsto' })
  obter(@CurrentUser() user: AuthenticatedUser, @Param('modeloLinhaId') id: string) {
    return this.svc.obter(user, id);
  }

  @Put('fichas/:modeloLinhaId')
  @ApiOperation({ summary: 'Salva a ficha (substitui a lista de insumos)' })
  salvar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('modeloLinhaId') id: string,
    @Body(new ZodValidationPipe(fichaSchema)) dto: FichaDto,
  ) {
    return this.svc.salvar(user, id, dto);
  }

  @Get('modelos/:modeloId/encaixe')
  @ApiOperation({ summary: 'Regras de encaixe do produto (null = não definidas)' })
  regrasEncaixe(@CurrentUser() user: AuthenticatedUser, @Param('modeloId') id: string) {
    return this.svc.regrasEncaixe(user, id);
  }

  @Put('modelos/:modeloId/encaixe')
  @ApiOperation({ summary: 'Salva as regras de encaixe do produto' })
  salvarRegrasEncaixe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('modeloId') id: string,
    @Body(new ZodValidationPipe(regrasEncaixeSchema)) dto: RegrasEncaixeDto,
  ) {
    return this.svc.salvarRegrasEncaixe(user, id, dto);
  }

  @Get('faccoes')
  @ApiOperation({ summary: 'Facções com a tabela de preço por modelo' })
  listarFaccoes(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listarFaccoes(user);
  }

  @Post('faccoes')
  @ApiOperation({ summary: 'Cadastra facção' })
  criarFaccao(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(faccaoSchema)) dto: FaccaoDto,
  ) {
    return this.svc.criarFaccao(user, dto);
  }

  @Put('faccoes/:id')
  @ApiOperation({ summary: 'Edita facção' })
  atualizarFaccao(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(faccaoSchema)) dto: FaccaoDto,
  ) {
    return this.svc.atualizarFaccao(user, id, dto);
  }

  @Delete('faccoes/:id')
  @ApiOperation({ summary: 'Exclui facção' })
  excluirFaccao(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.excluirFaccao(user, id);
  }

  @Put('faccoes/:id/precos')
  @ApiOperation({ summary: 'Tabela de preço por peça por modelo (substitui a da facção)' })
  salvarPrecos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(precosFaccaoSchema)) dto: PrecosFaccaoDto,
  ) {
    return this.svc.salvarPrecos(user, id, dto);
  }
}
