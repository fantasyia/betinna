import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type CompraInsumoDto,
  type InsumoDto,
  type MovimentoInsumoDto,
  compraInsumoSchema,
  insumoSchema,
  movimentoInsumoSchema,
} from './insumos.dto';
import { InsumosService } from './insumos.service';
import { InsumoFotosService, type ArquivoFoto } from './insumo-fotos.service';
import { EstoqueService } from './estoque.service';

/**
 * ERP próprio · matéria-prima (tecido e aviamento). Só ADMIN/DIRECTOR e só com
 * `config.erpInterno.ativo` (o service recusa com 422 fora disso).
 */
@ApiTags('erp')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('erp/insumos')
export class InsumosController {
  constructor(
    private readonly svc: InsumosService,
    private readonly fotos: InsumoFotosService,
    private readonly erp: EstoqueService,
  ) {}

  /**
   * Foto do insumo (Léo, 14/10): `corId` = id da COR DO INSUMO (uma por cor);
   * sem `corId` = foto do insumo sem cores. Troca a anterior.
   */
  @Post(':id/foto')
  @ApiOperation({ summary: 'Envia/troca a foto do insumo ou de uma cor dele (WebP + miniatura)' })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'foto', maxCount: 1 },
        { name: 'thumb', maxCount: 1 },
      ],
      { limits: { fileSize: 2 * 1024 * 1024, files: 2 } },
    ),
  )
  async enviarFoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFiles() arquivos: { foto?: ArquivoFoto[]; thumb?: ArquivoFoto[] } | undefined,
    @Body() body: { corId?: string },
  ) {
    const foto = arquivos?.foto?.[0];
    if (!foto) throw new BusinessRuleException('Nenhuma foto enviada');
    const empresaId = await this.erp.empresaLigada(user);
    return this.fotos.enviar(empresaId, id, body?.corId || null, foto, arquivos?.thumb?.[0]);
  }

  @Delete(':id/foto')
  @ApiOperation({ summary: 'Tira a foto do insumo ou de uma cor dele' })
  async excluirFoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('corId') corId?: string,
  ) {
    const empresaId = await this.erp.empresaLigada(user);
    return this.fotos.excluir(empresaId, id, corId || null);
  }

  @Get()
  @ApiOperation({ summary: 'Insumos com saldo, custo médio e alerta de reposição' })
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listar(user);
  }

  @Get('cores')
  @ApiOperation({ summary: 'Cores da empresa (a mesma lista da vitrine) pra dar cor ao insumo' })
  cores(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.coresDaEmpresa(user);
  }

  @Post()
  @ApiOperation({ summary: 'Cadastra insumo (tecido ou aviamento, unidade própria)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(insumoSchema)) dto: InsumoDto,
  ) {
    return this.svc.criar(user, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Edita insumo (unidade só muda sem movimento)' })
  atualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(insumoSchema)) dto: InsumoDto,
  ) {
    return this.svc.atualizar(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Exclui insumo SEM movimento (com histórico, desative)' })
  excluir(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.excluir(user, id);
  }

  @Post(':id/compras')
  @ApiOperation({ summary: 'Entrada de compra — recalcula o custo médio ponderado' })
  comprar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(compraInsumoSchema)) dto: CompraInsumoDto,
  ) {
    return this.svc.comprar(user, id, dto);
  }

  @Post(':id/movimentos')
  @ApiOperation({ summary: 'Perda, sobra que voltou ou ajuste — motivo obrigatório' })
  movimentar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(movimentoInsumoSchema)) dto: MovimentoInsumoDto,
  ) {
    return this.svc.movimentar(user, id, dto);
  }

  @Get(':id/movimentos')
  @ApiOperation({ summary: 'Histórico do insumo (mais recentes primeiro)' })
  movimentos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    // Só uma cor do insumo (opcional).
    @Query('cor') insumoCorId?: string,
  ) {
    return this.svc.movimentos(user, id, insumoCorId || undefined);
  }
}
