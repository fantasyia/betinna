import { BadRequestException, Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { frontendOrigin } from '@shared/utils/frontend-origin';
import { conferirNavegador, vincularNavegador } from '@shared/utils/oauth-navegador';
import { SheinOAuthService } from './shein-oauth.service';
import { SheinOrdersService } from './shein-orders.service';

const listarSchema = z.object({
  horas: z.coerce.number().int().min(1).max(48).default(48),
  tipo: z.coerce.number().int().min(1).max(2).default(1),
});

/** Shein (01/11): autorização da loja + leitura de pedidos. Diretoria. */
@ApiTags('integracoes/shein')
@Controller('integracoes/shein')
export class SheinController {
  constructor(
    private readonly oauth: SheinOAuthService,
    private readonly pedidos: SheinOrdersService,
  ) {}

  private empresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  @Get('oauth/start')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Link de autorização da loja na Shein (popup)' })
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ url: string }> {
    const url = await this.oauth.urlAutorizacao(this.empresa(user));
    vincularNavegador(res, url);
    return { url };
  }

  /** Callback público — autenticidade vem do state JWT + cookie do navegador. */
  @Public()
  @Get('oauth/callback')
  async callback(
    @Query('tempToken') tempToken: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!tempToken || !state) throw new BadRequestException('tempToken e state são obrigatórios');
    const outroNavegador = conferirNavegador(req, state);
    if (outroNavegador) return this.html(res, false, outroNavegador);
    try {
      const r = await this.oauth.processarCallback(tempToken, state);
      return this.html(res, true, `Loja Shein ${r.supplierId} autorizada.`);
    } catch (err) {
      return this.html(res, false, err instanceof Error ? err.message : 'falha desconhecida');
    }
  }

  @Get('pedidos')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Pedidos da Shein (crus) das últimas N horas (máx. 48)' })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listarSchema)) q: z.infer<typeof listarSchema>,
  ) {
    return this.pedidos.listar(this.empresa(user), q.horas, q.tipo as 1 | 2);
  }

  @Get('pedidos/:orderNo')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Detalhe cru de um pedido da Shein' })
  detalhe(@CurrentUser() user: AuthenticatedUser, @Param('orderNo') orderNo: string) {
    return this.pedidos.detalhe(this.empresa(user), [orderNo]);
  }

  private html(res: Response, ok: boolean, msg: string): void {
    const safe = String(msg).replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
    res
      .status(ok ? 200 : 400)
      // Mesmo motivo do Shopee: sem isto o popup perde o opener e não fecha.
      .setHeader('Cross-Origin-Opener-Policy', 'unsafe-none')
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? 'Autorizada' : 'Erro'}</title></head>
<body style="font-family:system-ui;padding:40px;text-align:center;">
<h2 style="color:${ok ? '#16a34a' : '#dc2626'};">${ok ? '✓ Autorizada' : '✗ Erro'}</h2>
<p>${safe}</p>
<p style="color:#666;font-size:14px;">Você pode fechar esta janela.</p>
<script>setTimeout(()=>{ if(window.opener){ window.opener.postMessage({type:'shein-oauth',ok:${ok}},'${frontendOrigin()}'); } window.close(); },1500);</script>
</body></html>`,
      );
  }
}
