import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { AmazonLwaService } from './amazon-lwa.service';

@ApiTags('integracoes/amazon')
@Controller('integracoes/amazon')
export class AmazonOAuthController {
  constructor(private readonly lwa: AmazonLwaService) {}

  @Get('oauth/start')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({
    summary: 'Inicia OAuth Selling Partner — redireciona pro Seller Central',
  })
  async start(@CurrentUser() user: AuthenticatedUser): Promise<{ url: string }> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const url = await this.lwa.buildAuthUrl(user.empresaIdAtiva);
    return { url };
  }

  /**
   * Callback público (Amazon não envia JWT). Autenticidade via state JWT.
   * Amazon retorna `spapi_oauth_code`, `selling_partner_id`, `state`,
   * `mws_auth_token` (legacy MWS — ignoramos).
   */
  @Public()
  @Get('oauth/callback')
  async callback(
    @Query('spapi_oauth_code') code: string | undefined,
    @Query('selling_partner_id') sellingPartnerId: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !sellingPartnerId || !state) {
      throw new BadRequestException(
        'spapi_oauth_code, selling_partner_id e state são obrigatórios',
      );
    }
    try {
      const r = await this.lwa.processCallback(code, sellingPartnerId, state);
      return this.html(res, true, `Amazon conectada (selling_partner_id=${r.sellingPartnerId}).`);
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
<script>setTimeout(()=>{ if(window.opener){ window.opener.postMessage({type:'amazon-oauth',ok:${ok}},'*'); } window.close(); },1500);</script>
</body></html>`,
      );
  }
}
