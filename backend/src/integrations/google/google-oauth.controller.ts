import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { GoogleOAuthService } from './google-oauth.service';
import { PrismaService } from '@database/prisma.service';
import { paginaRetornoOAuth, type MarcaPagina } from '@shared/oauth/pagina-retorno-oauth';
import { frontendOrigin } from '@shared/utils/frontend-origin';

@ApiTags('integracoes/google')
@Controller('integracoes/google')
export class GoogleOAuthController {
  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('oauth/status')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Se o app Google (client id/secret) está configurado no ambiente — pra UI orientar',
  })
  status(): { configurado: boolean } {
    return { configurado: this.oauth.isConfigured() };
  }

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
   * Retorna a página de retorno padrão (`paginaRetornoOAuth`), com a marca do
   * tenant quando dá pra saber quem é — o `state` traz o `userId`, e é dele que
   * sai a empresa. No erro anterior à troca do código não há usuário, e a
   * página cai no visual do Betinna.
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
      return this.responder(res, false, 'Não deu pra conectar', `O Google respondeu: ${error}`);
    }
    if (!code || !state) {
      throw new BadRequestException('code e state são obrigatórios');
    }
    try {
      const { userId, email } = await this.oauth.exchangeCode(code, state);
      return this.responder(
        res,
        true,
        'Agenda conectada',
        `A conta ${email} está conectada. Seus compromissos passam a espelhar no Google Agenda.`,
        await this.marcaDoUsuario(userId),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'falha desconhecida';
      return this.responder(res, false, 'Não deu pra conectar', msg);
    }
  }

  /**
   * Marca do tenant do usuário — a MESMA fonte que os e-mails usam
   * (`Empresa.config.marca`), pra as duas pontas não divergirem quando alguém
   * trocar a logo num lugar só.
   *
   * É enfeite: qualquer tropeço aqui vira página sem marca, nunca erro. A
   * pessoa acabou de autorizar no Google — falhar a tela por causa de uma logo
   * faria parecer que a conexão não deu certo, quando deu.
   */
  private async marcaDoUsuario(userId: string): Promise<MarcaPagina | undefined> {
    try {
      // `Usuario` liga em empresa por N-pra-N (`UsuarioEmpresa`). Quem conecta
      // a agenda tem uma só na prática; se tiver mais, a primeira é a mesma
      // que o resto do app usa como ativa por padrão.
      const vinculo = await this.prisma.usuarioEmpresa.findFirst({
        where: { usuarioId: userId },
        select: { empresa: { select: { nome: true, config: true } } },
      });
      const m = ((vinculo?.empresa?.config as Record<string, unknown> | null)?.marca ?? {}) as {
        corPrimaria?: string;
        corSecundaria?: string;
        headerImgUrl?: string;
        logoEmailUrl?: string;
      };
      if (!m.logoEmailUrl || !m.corPrimaria) return undefined;
      return {
        empresaNome: vinculo?.empresa?.nome ?? '',
        logoUrl: m.logoEmailUrl,
        corPrimaria: m.corPrimaria,
        corSecundaria: m.corSecundaria ?? undefined,
        headerImgUrl: m.headerImgUrl ?? undefined,
      };
    } catch {
      return undefined;
    }
  }

  private responder(
    res: Response,
    ok: boolean,
    titulo: string,
    mensagem: string,
    marca?: MarcaPagina,
  ): void {
    res
      .status(ok ? 200 : 400)
      .type('html')
      .send(
        paginaRetornoOAuth({
          ok,
          titulo,
          mensagem,
          canal: 'google-oauth',
          origem: frontendOrigin(),
          marca,
        }),
      );
  }
}
