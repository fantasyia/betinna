import { BadRequestException, Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { frontendOrigin } from '@shared/utils/frontend-origin';
import { conferirNavegador, vincularNavegador } from '@shared/utils/oauth-navegador';
import { MagaluOAuthService } from './magalu-oauth.service';

@ApiTags('integracoes/magalu')
@Controller('integracoes/magalu')
export class MagaluOAuthController {
  constructor(private readonly oauth: MagaluOAuthService) {}

  @Get('oauth/start')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Inicia o consentimento do ID Magalu. **DIRETOR-only (D45)**.' })
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

  /** Callback público — a autenticidade vem do `state` assinado (uso único). */
  @Public()
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') erro: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (erro) return this.html(res, false, `Magalu recusou: ${erro}`);
    if (!code || !state) throw new BadRequestException('code e state são obrigatórios');
    const outroNavegador = conferirNavegador(req, state);
    if (outroNavegador) return this.html(res, false, outroNavegador);
    try {
      const r = await this.oauth.processCallback(code, state);
      return this.html(res, true, `Loja Magalu ${r.loja} conectada.`);
    } catch (err) {
      return this.html(res, false, err instanceof Error ? err.message : 'falha desconhecida');
    }
  }

  private html(res: Response, ok: boolean, msg: string): void {
    const safe = String(msg).replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
    res
      .status(ok ? 200 : 400)
      // COOP: sem `unsafe-none` o Helmet corta o `opener` do popup (ver @shared/oauth).
      .setHeader('Cross-Origin-Opener-Policy', 'unsafe-none')
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? 'Conectada' : 'Erro'}</title></head>
<body style="font-family:system-ui;padding:40px;text-align:center;">
<h2 style="color:${ok ? '#16a34a' : '#dc2626'};">${ok ? '✓ Conectada' : '✗ Erro'}</h2>
<p>${safe}</p>
<p style="color:#666;font-size:14px;">Você pode fechar esta janela.</p>
<script>setTimeout(()=>{ if(window.opener){ window.opener.postMessage({type:'magalu-oauth',ok:${ok}},'${frontendOrigin()}'); } window.close(); },1500);</script>
</body></html>`,
      );
  }
}
