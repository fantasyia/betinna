import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RotasApiService } from './rotas-api.service';

/** Catálogo das rotas que o token `tudo` alcança (MCP: betinna_rotas). */
@ApiTags('rotas-api')
@ApiBearerAuth()
@Controller('rotas-api')
export class RotasApiController {
  constructor(private readonly svc: RotasApiService) {}

  @Get()
  @ApiOperation({ summary: 'Rotas da API que o token "tudo" alcança (método, caminho, resumo)' })
  listar(@Query('filtro') filtro?: string) {
    return this.svc.listar(filtro?.slice(0, 80));
  }
}
