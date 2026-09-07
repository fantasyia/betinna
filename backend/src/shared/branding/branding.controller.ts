import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@shared/decorators/public.decorator';
import { BrandingService, type Branding } from './branding.service';

/**
 * Marca do tenant PELO DOMÍNIO — público de propósito.
 *
 * A tela de login precisa da marca ANTES de existir usuário autenticado. Se
 * dependesse de token, o representante veria o Betinna primeiro e a marca da
 * empresa dele só depois de entrar — que é exatamente o que o white-label
 * existe pra evitar.
 *
 * Devolve só o que já é público de qualquer forma (nome, logo, cores). Nada
 * daqui identifica a empresa além do que o domínio já entrega.
 */
@ApiTags('branding')
@Controller('public')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Public()
  @Get('branding')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Marca do tenant que atende neste domínio (sem autenticação).' })
  resolver(
    @Headers('host') host?: string,
    /** Só pra diagnóstico e dev local, onde o host é `localhost:5173`. */
    @Query('host') hostQuery?: string,
  ): Promise<Branding> {
    return this.branding.porHost(hostQuery || host);
  }
}
