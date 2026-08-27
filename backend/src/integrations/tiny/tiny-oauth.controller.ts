import { BadRequestException, Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
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
import { TinyContaService } from './tiny-conta.service';
import { TinyProdutosService } from './tiny-produtos.service';
import { TinyPedidosService } from './tiny-pedidos.service';
import { TinyProdutosSyncService } from './tiny-produtos-sync.service';
import {
  importarProdutosSchema,
  listaPrecoSchema,
  pedidoTinySchema,
  imagensProdutoSchema,
  type ImportarProdutosDto,
  type ListaPrecoDto,
  type PedidoTinyDto,
  type ImagensProdutoDto,
} from './tiny.dto';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { Audit } from '@shared/decorators/audit.decorator';
import type { TinyCredenciais } from './tiny.types';

@ApiTags('integracoes/tiny')
@Controller('integracoes/tiny')
export class TinyOAuthController {
  constructor(
    private readonly oauth: TinyOAuthService,
    private readonly integracoes: IntegracoesService,
    private readonly conta: TinyContaService,
    private readonly produtos: TinyProdutosService,
    private readonly pedidos: TinyPedidosService,
    private readonly sync: TinyProdutosSyncService,
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

  /**
   * Raio-X da conta no Tiny: depósitos, vendedores, formas de envio e produtos.
   *
   * Existe pro setup não depender de alguém transcrever id à mão — o
   * `POST /pedidos` exige `deposito.id` e `vendedor.id`, e id errado faz o
   * pedido nascer no depósito errado. Também é o teste de fumaça da integração:
   * se responde, OAuth + refresh + cliente HTTP estão de pé.
   */
  @Get('conta')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @ApiOperation({
    summary: 'O que está cadastrado no Tiny (depósitos, vendedores, envio, produtos)',
  })
  async raioX(@CurrentUser() user: AuthenticatedUser) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.conta.raioX(user.empresaIdAtiva);
  }

  /**
   * Sobe catálogo pro Tiny. Caminho INVERSO do sync, e só faz sentido no
   * bootstrap: a conta do ERP nasce vazia e o catálogo tem que chegar de algum
   * lugar. Depois disso o Tiny vira a fonte da verdade e o app passa a LER.
   *
   * Idempotente por SKU — rodar duas vezes atualiza, não duplica.
   */
  @Post('produtos/importar')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'IMPORTAR', resource: 'tiny_produtos' })
  @ApiOperation({
    summary: 'Cria/atualiza produtos no Tiny a partir de uma lista (idempotente por SKU)',
  })
  async importarProdutos(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importarProdutosSchema)) dto: ImportarProdutosDto,
  ) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.produtos.importar(user.empresaIdAtiva, dto.produtos);
  }

  /**
   * Cria lista de preços (ex.: "Locação mensal"). É como o Tiny separa o mesmo
   * produto com preço diferente, sem duplicar cadastro nem estoque.
   */
  @Post('listas-preco')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'CRIAR', resource: 'tiny_lista_preco' })
  @ApiOperation({ summary: 'Cria uma lista de preços no Tiny com preços por SKU' })
  async criarListaPreco(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(listaPrecoSchema)) dto: ListaPrecoDto,
  ) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.produtos.definirListaPreco(user.empresaIdAtiva, dto);
  }

  /**
   * Cria um pedido no Tiny a partir de itens por SKU.
   *
   * É o mesmo caminho que o pedido do site vai usar — a ponte site → Betinna →
   * ERP (item 8) só monta este payload a partir do checkout.
   */
  @Post('pedidos')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'CRIAR', resource: 'tiny_pedido' })
  @ApiOperation({ summary: 'Cria pedido no Tiny (itens por SKU)' })
  async criarPedido(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(pedidoTinySchema)) dto: PedidoTinyDto,
  ) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.pedidos.criar(user.empresaIdAtiva, dto);
  }

  /**
   * Puxa o catálogo do Tiny pra cá. Incremental por padrão (só o que mudou
   * desde o último sync); `?modo=completo` força tudo.
   */
  @Post('sync/produtos')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'SYNC', resource: 'tiny_produtos' })
  @ApiOperation({ summary: 'Sincroniza produtos + estoque do Tiny para o app' })
  async sincronizarProdutos(@CurrentUser() user: AuthenticatedUser, @Query('modo') modo?: string) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.sync.sync(user.empresaIdAtiva, {
      modo: modo === 'completo' ? 'completo' : 'incremental',
    });
  }

  @Post('produtos/imagens')
  @ApiBearerAuth()
  @Roles('ADMIN', 'DIRECTOR')
  @Audit({ action: 'ANEXAR', resource: 'tiny_produto_imagem' })
  @ApiOperation({ summary: 'Anexa imagens (por URL) aos produtos do Tiny' })
  async anexarImagens(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(imagensProdutoSchema)) dto: ImagensProdutoDto,
  ) {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return this.produtos.anexarImagens(user.empresaIdAtiva, dto.itens);
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
