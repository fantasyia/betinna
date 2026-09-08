import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
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
    /**
     * O front e a API moram em domínios diferentes: o `Host` que chega aqui é o
     * da API, não o do app. Quem manda é o host explícito (o front sempre
     * envia); o `Origin` é a segunda melhor pista.
     */
    @Query('host') hostQuery?: string,
    @Headers('origin') origin?: string,
  ): Promise<Branding> {
    return this.branding.porHost(hostQuery || origin || host);
  }

  /**
   * Manifest do PWA POR TENANT.
   *
   * O manifest do build é estático e carrega o nome do produto. Sem este
   * endpoint, o representante que salva o app na tela do celular vê um atalho
   * chamado "Betinna" com a cor do Betinna — mesmo tendo entrado pelo domínio da
   * empresa dele.
   *
   * `@Res()` cru: pelo caminho normal o `ResponseInterceptor` envelopa em
   * `{success, data}` e o navegador descarta o manifest calado.
   */
  @Public()
  @Get('manifest.webmanifest')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Manifest PWA com a marca do tenant deste domínio.' })
  async manifest(
    @Res() res: Response,
    @Headers('host') host?: string,
    @Query('host') hostQuery?: string,
    @Headers('origin') origin?: string,
  ): Promise<void> {
    const b = await this.branding.porHost(hostQuery || origin || host);
    res
      .status(200)
      .type('application/manifest+json')
      // Marca muda raramente, mas quando muda não pode demorar um dia: 1h com
      // revalidação é o meio-termo entre isso e bater na API a cada abertura.
      .setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    res.send(
      JSON.stringify({
        name: b.nome,
        short_name: b.nomeCurto,
        theme_color: b.cores.acao,
        background_color: b.cores.primaria,
        // 'browser' (não 'standalone'): o app é SOMENTE ONLINE — mesma decisão
        // do manifest do build, e trocar aqui reabriria a instalação que foi
        // desligada de propósito.
        display: 'browser',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/dashboard',
        lang: 'pt-BR',
        icons: iconesDaMarca(b),
      }),
    );
  }
}

/**
 * Ícone do manifest.
 *
 * ⛔ Tenant NUNCA cai no ícone do produto: o atalho da Somatec na tela do
 * celular com o símbolo do Betinna é o vazamento mais visível que existe.
 * Sem logo próprio, o manifest vai SEM ícone — o navegador desenha a inicial
 * do nome, que já é a marca certa.
 *
 * O `sizes` também não pode mentir: declarar 192x192 pra uma imagem de outra
 * dimensão faz o navegador recusar o ícone com erro no console (foi o "erro ao
 * renderizar a imagem" relatado em 07/09).
 */
function iconesDaMarca(b: Branding): Array<Record<string, string>> {
  const src = b.logoUrl || (b.dominio ? null : '/betinna-symbol.png');
  if (!src) return [];
  const ext = (src.split('?')[0] ?? '').split('.').pop()?.toLowerCase() ?? '';
  const type =
    ext === 'svg'
      ? 'image/svg+xml'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/png';
  // `any`: o tamanho real do arquivo do tenant é desconhecido aqui, e chutar
  // um número é exatamente o que quebra.
  return [{ src, sizes: 'any', type, purpose: 'any' }];
}
