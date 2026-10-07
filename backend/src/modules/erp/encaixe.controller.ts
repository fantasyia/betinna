import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  TIPOS_ARQUIVO_ENCAIXE,
  type CriarEncaixeDto,
  type FalhaEncaixeDto,
  type ProgressoEncaixeDto,
  type ResultadoEncaixeDto,
  type TipoArquivoEncaixe,
  criarEncaixeSchema,
  falhaEncaixeSchema,
  progressoEncaixeSchema,
  resultadoEncaixeSchema,
} from './encaixe.dto';
import { EncaixeService } from './encaixe.service';

/** Encaixe (risco) pela tela da OP. ADMIN/DIRECTOR e ERP ligado. */
@ApiTags('erp')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('erp')
export class EncaixeController {
  constructor(private readonly svc: EncaixeService) {}

  @Post('ops/:id/encaixes')
  @ApiOperation({ summary: 'Pede um risco pra esta OP (vai pra fila do agente da GPU)' })
  criar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(criarEncaixeSchema)) dto: CriarEncaixeDto,
  ) {
    return this.svc.criar(user, id, dto);
  }

  @Get('ops/:id/encaixes')
  @ApiOperation({ summary: 'Riscos desta OP (mais recentes primeiro), com progresso' })
  listar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.listarDaOp(user, id);
  }

  @Post('encaixes/:id/cancelar')
  cancelar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.cancelar(user, id);
  }

  @Get('encaixes/:id/arquivos/:tipo')
  @ApiOperation({ summary: 'Baixa o .plt (plotter) ou a imagem do risco' })
  async arquivo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('tipo', new ZodValidationPipe(z.enum(TIPOS_ARQUIVO_ENCAIXE))) tipo: TipoArquivoEncaixe,
    @Res() res: Response,
  ) {
    const a = await this.svc.arquivo(user, id, tipo);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `${tipo === 'PLT' || tipo === 'DXF' ? 'attachment' : 'inline'}; filename="${a.nome}"`,
    );
    res.send(a.conteudo);
  }
}

/**
 * Agente local do encaixe (PC do Léo, GPU). Entra com token de escopo
 * `encaixe` (o guard só deixa este prefixo). Ciclo: proximo → progresso… →
 * resultado | falha; consulta a situação pra parar se cancelarem.
 */
@ApiTags('erp')
@ApiBearerAuth()
@Roles('ADMIN', 'DIRECTOR')
@Controller('erp/encaixe/agente')
export class EncaixeAgenteController {
  constructor(private readonly svc: EncaixeService) {}

  @Post('proximo')
  @ApiOperation({ summary: 'Pega o próximo risco da fila (um por vez)' })
  proximo(@CurrentUser() user: AuthenticatedUser, @Req() req: { apiToken?: { nome?: string } }) {
    return this.svc.proximo(user, req.apiToken?.nome ?? `sessão ${user.id}`);
  }

  @Get(':id')
  situacao(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.situacao(user, id);
  }

  @Post(':id/progresso')
  progresso(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(progressoEncaixeSchema)) dto: ProgressoEncaixeDto,
  ) {
    return this.svc.progresso(user, id, dto);
  }

  @Post(':id/resultado')
  concluir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resultadoEncaixeSchema)) dto: ResultadoEncaixeDto,
  ) {
    return this.svc.concluir(user, id, dto);
  }

  @Post(':id/falha')
  falhar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(falhaEncaixeSchema)) dto: FalhaEncaixeDto,
  ) {
    return this.svc.falhar(user, id, dto);
  }
}
