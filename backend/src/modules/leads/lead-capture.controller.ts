import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { LeadCaptureService } from './lead-capture.service';
import { leadCapturePublicoSchema, type LeadCapturePublicoDto } from './lead-capture.dto';

@ApiTags('leads')
@Controller()
export class LeadCaptureController {
  constructor(private readonly svc: LeadCaptureService) {}

  // ─── Receiver público (formulários do site POSTam aqui) ──────────────
  @Public()
  @Post('public/leads')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria um lead a partir de formulário externo (chave x-api-key)' })
  capturar(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-api-key') apiKey: string | undefined,
    @Body(new ZodValidationPipe(leadCapturePublicoSchema)) dto: LeadCapturePublicoDto,
  ) {
    // Passa o corpo CRU: se o site enviou em latin1 (acentos vêm como �), o
    // service re-decodifica a partir dos bytes originais e recupera os acentos.
    return this.svc.capturar(apiKey, dto, req.rawBody);
  }

  @Public()
  @Get('public/funis')
  @ApiOperation({
    summary: 'Lista os funis (com etapas) do tenant — descobre funilId/funilEtapaId (x-api-key)',
  })
  listarFunis(@Headers('x-api-key') apiKey: string | undefined) {
    return this.svc.listarFunis(apiKey);
  }

  // ─── Gestão da chave (DIRECTOR/ADMIN) ─────────────────────────────────
  @ApiBearerAuth()
  @Get('leads-capture/chave')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Status da chave de captura (prefixo/uso — nunca a chave)' })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.status(user);
  }

  @ApiBearerAuth()
  @Post('leads-capture/chave/gerar')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Gera/rotaciona a chave de captura (mostrada UMA vez)' })
  gerar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.gerarChave(user);
  }

  @ApiBearerAuth()
  @Post('leads-capture/chave/desativar')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Desativa a chave (formulários param de criar leads)' })
  desativar(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.desativar(user);
  }

  // ─── Chave de PEDIDOS do site (separada da de leads desde 29/09/2026) ──
  @ApiBearerAuth()
  @Get('leads-capture/chave-pedidos')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Status da chave de pedidos do site (prefixo/uso — nunca a chave)' })
  statusPedidos(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.statusPedidos(user);
  }

  @ApiBearerAuth()
  @Post('leads-capture/chave-pedidos/gerar')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Gera/rotaciona a chave de pedidos do site (mostrada UMA vez)' })
  gerarPedidos(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.gerarChavePedidos(user);
  }

  @ApiBearerAuth()
  @Post('leads-capture/chave-pedidos/desativar')
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Desativa a chave de pedidos (o checkout para de criar pedidos)' })
  desativarPedidos(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.desativarPedidos(user);
  }
}
