import { BadRequestException, Controller, Get, Query, Req, Res } from '@nestjs/common';
import { conferirNavegador, vincularNavegador } from '@shared/utils/oauth-navegador';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { TikTokOAuthService } from './tiktok-oauth.service';
import { frontendOrigin } from '@shared/utils/frontend-origin';

@ApiTags('integracoes/tiktok')
@Controller('integracoes/tiktok')
export class TikTokOAuthController {
  constructor(private readonly oauth: TikTokOAuthService) {}

  @Get('oauth/start')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Inicia shop authorization TikTok Shop. **DIRETOR-only (D45)**.' })
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ url: string }> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const url = await this.oauth.buildAuthUrl(user.empresaIdAtiva);
    // Amarra o link a ESTE navegador (auditoria 29/09/2026 — oauth-navegador.ts).
    vincularNavegador(res, url);
    return { url };
  }

  @Public()
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !state) {
      throw new BadRequestException('code e state são obrigatórios');
    }
    // Navegador que voltou tem que ser o que clicou em "Conectar" (auditoria 29/09/2026).
    const outroNavegador = conferirNavegador(req, state);
    if (outroNavegador) return this.html(res, false, outroNavegador);
    try {
      const r = await this.oauth.processCallback(code, state);
      return this.html(res, true, `Loja TikTok shop_id=${r.shopId} conectada.`);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'falha desconhecida';
      return this.html(res, false, m);
    }
  }

  private html(res: Response, ok: boolean, msg: string): void {
    const safe = String(msg).replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
    res
      .status(ok ? 200 : 400)
      // COOP: o Helmet manda `same-origin` em tudo, e nesta rota isso corta o
      // `opener` do popup — o que BARRA o `window.close()` do script abaixo e
      // pula o `postMessage`. Medido no Google em 10/09; o defeito é o mesmo
      // aqui, e existe desde o commit inicial. Ver `@shared/oauth`.
      .setHeader('Cross-Origin-Opener-Policy', 'unsafe-none')
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? 'Conectada' : 'Erro'}</title></head>
<body style="font-family:system-ui;padding:40px;text-align:center;">
<h2 style="color:${ok ? '#16a34a' : '#dc2626'};">${ok ? '✓ Conectada' : '✗ Erro'}</h2>
<p>${safe}</p>
<p style="color:#666;font-size:14px;">Você pode fechar esta janela.</p>
<script>setTimeout(()=>{ if(window.opener){ window.opener.postMessage({type:'tiktok-oauth',ok:${ok}},'${frontendOrigin()}'); } window.close(); },1500);</script>
</body></html>`,
      );
  }
}
