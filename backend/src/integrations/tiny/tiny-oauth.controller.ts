import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { frontendOrigin } from '@shared/utils/frontend-origin';
import { TinyOAuthService } from './tiny-oauth.service';
import type { TinyCredenciais } from './tiny.types';

@ApiTags('integracoes/tiny')
@Controller('integracoes/tiny')
export class TinyOAuthController {
  constructor(
    private readonly oauth: TinyOAuthService,
    private readonly integracoes: IntegracoesService,
  ) {}

  @Get('oauth/start')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Inicia OAuth com o Tiny (Olist). **DIRETOR-only (D45)**.' })
  async start(@CurrentUser() user: AuthenticatedUser): Promise<{ url: string }> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return { url: await this.oauth.buildAuthUrl(user.empresaIdAtiva) };
  }

  /**
   * Status da conexão.
   *
   * Devolve `refreshExpiraEm` de propósito: no Tiny o refresh dura 1 DIA, então
   * "conectado" sem prazo à vista seria informação enganosa — a tela precisa
   * conseguir dizer quanto tempo falta antes de exigir reconexão manual.
   */
  @Get('status')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Status da integração Tiny (conectado, validade dos tokens)' })
  async status(@CurrentUser() user: AuthenticatedUser): Promise<{
    configurado: boolean;
    conectado: boolean;
    accessExpiraEm: string | null;
    refreshExpiraEm: string | null;
  }> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const configurado = this.oauth.isConfigured();
    const cred = await this.integracoes
      .obterCredenciaisInternas(user.empresaIdAtiva, 'tiny')
      .then((c) => c.credenciais as Partial<TinyCredenciais>)
      .catch(() => null);

    return {
      configurado,
      conectado: Boolean(cred?.accessToken),
      accessExpiraEm: cred?.expiresAt ? new Date(cred.expiresAt).toISOString() : null,
      refreshExpiraEm: cred?.refreshExpiresAt
        ? new Date(cred.refreshExpiresAt).toISOString()
        : null,
    };
  }

  @Public()
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDesc: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (error) return this.html(res, false, errorDesc || `Tiny retornou erro: ${error}`);
    if (!code || !state) throw new BadRequestException('code e state são obrigatórios');
    try {
      await this.oauth.processCallback(code, state);
      return this.html(res, true, 'ERP Tiny conectado com sucesso.');
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
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? 'Conectado' : 'Erro'}</title></head>
<body style="font-family:system-ui;padding:40px;text-align:center;">
<h2 style="color:${ok ? '#16a34a' : '#dc2626'};">${ok ? '✓ Conectado' : '✗ Erro'}</h2>
<p>${safe}</p>
<p style="color:#666;font-size:14px;">Você pode fechar esta janela.</p>
<script>setTimeout(()=>{ if(window.opener){ window.opener.postMessage({type:'tiny-oauth',ok:${ok}},'${frontendOrigin()}'); } window.close(); },1500);</script>
</body></html>`,
      );
  }
}
