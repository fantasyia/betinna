import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ShopeeOAuthService } from './shopee-oauth.service';

@ApiTags('integracoes/shopee')
@Controller('integracoes/shopee')
export class ShopeeOAuthController {
  constructor(private readonly oauth: ShopeeOAuthService) {}

  @Get('oauth/start')
  @ApiBearerAuth()
  @Roles('DIRECTOR')
  @ApiOperation({
    summary:
      'Inicia shop authorization Shopee — redireciona pro partner authorize. **DIRETOR-only (D45)**.',
  })
  async start(@CurrentUser() user: AuthenticatedUser): Promise<{ url: string }> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const url = await this.oauth.buildAuthUrl(user.empresaIdAtiva);
    return { url };
  }

  /**
   * Callback público — autenticidade vem do state JWT que embutimos no redirect_uri.
   * Shopee anexa `code`, `shop_id` (ou `main_account_id`) e preserva nosso `state`.
   */
  @Public()
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('shop_id') shopId: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !shopId || !state) {
      throw new BadRequestException('code, shop_id e state são obrigatórios');
    }
    try {
      const r = await this.oauth.processCallback(code, shopId, state);
      return this.html(res, true, `Loja Shopee shop_id=${r.shopId} conectada.`);
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
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? 'Conectada' : 'Erro'}</title></head>
<body style="font-family:system-ui;padding:40px;text-align:center;">
<h2 style="color:${ok ? '#16a34a' : '#dc2626'};">${ok ? '✓ Conectada' : '✗ Erro'}</h2>
<p>${safe}</p>
<p style="color:#666;font-size:14px;">Você pode fechar esta janela.</p>
<script>setTimeout(()=>{ if(window.opener){ window.opener.postMessage({type:'shopee-oauth',ok:${ok}},'*'); } window.close(); },1500);</script>
</body></html>`,
      );
  }
}
