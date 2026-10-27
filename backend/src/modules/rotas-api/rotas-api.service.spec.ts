import 'reflect-metadata';
import { Controller, Get, Put } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApiOperation } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';
import { RotasApiService } from './rotas-api.service';

@Controller('erp')
class ErpFalso {
  @Get('acabamento')
  @ApiOperation({ summary: 'Serviços de acabamento' })
  ver() {
    return 1;
  }

  @Put('acabamento')
  salvar() {
    return 1;
  }
}

@Controller('fluxos')
class FluxosFalso {
  @Put(':id/ativar')
  ativar() {
    return 1;
  }
}

describe('RotasApiService — lê os controllers no boot', () => {
  it('monta método + caminho + resumo, sem as rotas fora do "tudo"', async () => {
    const mod = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [ErpFalso, FluxosFalso],
      providers: [RotasApiService],
    }).compile();
    await mod.init();
    expect(mod.get(RotasApiService).listar()).toEqual([
      { metodo: 'GET', caminho: '/erp/acabamento', resumo: 'Serviços de acabamento' },
      { metodo: 'PUT', caminho: '/erp/acabamento', resumo: null },
    ]);
  });
});
