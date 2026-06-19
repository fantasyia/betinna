import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { GoogleOAuthService } from './google-oauth.service';
import { frontendOrigin } from '@shared/utils/frontend-origin';

@ApiTags('integracoes/google')
@Controller('integracoes/google')
export class GoogleOAuthController {
  constructor(private readonly oauth: GoogleOAuthService) {}

  @Get('oauth/start')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Inicia OAuth com Google — retorna URL pra redirecionar o user',
  })
  async start(@CurrentUser() user: AuthenticatedUser): Promise<{ url: string }> {
    const url = await this.oauth.buildAuthUrl(user.id);
    return { url };
  }

  /**
   * Callback do Google. PÚBLICO (Google não envia JWT do nosso AuthGuard);
   * a autenticidade vem do `state` JWT assinado por nós.
   *
   * Retorna HTML simples que serve para fechar a janela ou exibir sucesso/erro
   * — o frontend pode opcionalmente escutar `window.opener` postMessage.
   */
  @Public()
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      return this.html(res, false, `Google retornou erro: ${error}`);
    }
    if (!code || !state) {
      throw new BadRequestException('code e state são obrigatórios');
    }
    try {
      const { email } = await this.oauth.exchangeCode(code, state);
      return this.html(res, true, `Conta ${email} conectada com sucesso.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'falha desconhecida';
      return this.html(res, false, msg);
    }
  }

  private html(res: Response, ok: boolean, msg: string): void {
    const safeMsg = String(msg).replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
    res
      .status(ok ? 200 : 400)
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? 'Conectado' : 'Erro'}</title></head>
<body style="font-family:system-ui;padding:40px;text-align:center;">
<h2 style="color:${ok ? '#16a34a' : '#dc2626'};">${ok ? '✓ Conectado' : '✗ Erro'}</h2>
<p>${safeMsg}</p>
<p style="color:#666;font-size:14px;">Você pode fechar esta janela.</p>
<script>setTimeout(()=>{ if(window.opener){ window.opener.postMessage({type:'google-oauth',ok:${ok}},'${frontendOrigin()}'); } window.close(); },1500);</script>
</body></html>`,
      );
  }
}
