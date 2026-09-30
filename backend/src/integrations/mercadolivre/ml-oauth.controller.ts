import { BadRequestException, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { conferirNavegador, vincularNavegador } from '@shared/utils/oauth-navegador';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { MLOAuthService } from './ml-oauth.service';
import { MLQuestionsService } from './ml-questions.service';
import { MLRespostaIaService } from './ml-resposta-ia.service';
import { frontendOrigin } from '@shared/utils/frontend-origin';

@ApiTags('integracoes/mercadolivre')
@Controller('integracoes/mercadolivre')
export class MLOAuthController {
  constructor(
    private readonly oauth: MLOAuthService,
    private readonly questions: MLQuestionsService,
    private readonly respostaIa: MLRespostaIaService,
  ) {}

  /**
   * Sugere resposta pra uma pergunta de anúncio lendo o próprio anúncio (IA).
   * Não envia nada — devolve o texto pro vendedor revisar (Léo, 29/09).
   */
  @Post('perguntas/:conversationId/sugerir-resposta')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'SAC')
  @ApiOperation({ summary: 'Sugestão de resposta (IA + dados do anúncio). Não envia.' })
  async sugerirResposta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.respostaIa.sugerirPorConversa(user.empresaIdAtiva, conversationId);
  }

  /** Título, link e status do anúncio da pergunta (tela de pré-venda). */
  @Get('anuncios/:itemId')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR', 'GERENTE', 'SAC')
  @ApiOperation({ summary: 'Resumo do anúncio (título, link, status).' })
  async resumoAnuncio(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    // id do ML = site + número (MLB123…); qualquer outra coisa não vai pra URL da API
    if (!/^[A-Z]{3}\d{1,20}$/.test(itemId)) throw new BadRequestException('Anúncio inválido');
    return this.respostaIa.resumoAnuncio(user.empresaIdAtiva, itemId);
  }

  /** Diagnóstico só de leitura das perguntas pendentes da empresa ativa (ver o serviço). */
  @Get('diagnostico/perguntas')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Diagnóstico das perguntas pendentes (só leitura).' })
  async diagnosticoPerguntas(@CurrentUser() user: AuthenticatedUser) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const creds = await this.oauth.getAccessToken(user.empresaIdAtiva);
    return this.questions.diagnosticoPendentes(user.empresaIdAtiva, String(creds.userId));
  }

  @Get('oauth/start')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Inicia OAuth com Mercado Livre. **DIRETOR-only (D45)**.' })
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
    @Query('error') error: string | undefined,
    @Query('error_description') errorDesc: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      return this.html(res, false, errorDesc || `ML retornou erro: ${error}`);
    }
    if (!code || !state) {
      throw new BadRequestException('code e state são obrigatórios');
    }
    // Navegador que voltou tem que ser o que clicou em "Conectar" (auditoria 29/09/2026).
    const outroNavegador = conferirNavegador(req, state);
    if (outroNavegador) return this.html(res, false, outroNavegador);
    try {
      const r = await this.oauth.processCallback(code, state);
      return this.html(res, true, `Conta ML user_id=${r.userId} conectada com sucesso.`);
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
        `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? 'Conectado' : 'Erro'}</title></head>
<body style="font-family:system-ui;padding:40px;text-align:center;">
<h2 style="color:${ok ? '#16a34a' : '#dc2626'};">${ok ? '✓ Conectado' : '✗ Erro'}</h2>
<p>${safe}</p>
<p style="color:#666;font-size:14px;">Você pode fechar esta janela.</p>
<script>setTimeout(()=>{ if(window.opener){ window.opener.postMessage({type:'ml-oauth',ok:${ok}},'${frontendOrigin()}'); } window.close(); },1500);</script>
</body></html>`,
      );
  }
}
