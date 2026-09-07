import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@shared/decorators/public.decorator';
import { DescadastroService } from './descadastro.service';

/**
 * Página pública de descadastro — sem login, sem sessão.
 *
 * **GET não descadastra, de propósito.** Gmail e Outlook pré-carregam links de
 * e-mail com scanner de segurança; um GET que aplica a tag tiraria da lista gente
 * que nunca clicou. Então o GET devolve uma página com um botão, e quem
 * descadastra é o POST.
 *
 * O POST atende os DOIS caminhos: o botão da página e o **one-click do provedor**
 * (RFC 8058 — `List-Unsubscribe-Post: List-Unsubscribe=One-Click` faz o Gmail
 * POSTar sozinho quando a pessoa clica no botão nativo "cancelar inscrição").
 *
 * Responde HTML CRU, com `@Res()`, porque quem abre isto é uma pessoa no
 * navegador: pelo caminho normal o `ResponseInterceptor` envelopa tudo em
 * `{success, data}` e o navegador mostraria o JSON com a página dentro.
 */
@ApiExcludeController()
@Controller()
export class DescadastroController {
  constructor(private readonly descadastro: DescadastroService) {}

  @Public()
  @Get('descadastrar')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  paginaConfirmar(@Res() res: Response, @Query('t') token?: string): void {
    if (!token) {
      html(res, pagina('Link inválido', 'Este link de descadastro está incompleto.'));
      return;
    }
    html(
      res,
      pagina(
        'Cancelar os e-mails',
        'Confirme abaixo e você não recebe mais nossos e-mails de novidades e acompanhamento. ' +
          'Avisos sobre um pedido que você fez (confirmação, nota, rastreio) continuam chegando.',
        token,
        this.descadastro.caminhoDescadastro(),
      ),
    );
  }

  /**
   * Descadastra. Aceita o token na query (one-click do provedor) ou no corpo do
   * formulário (botão da página).
   */
  @Public()
  @Post('descadastrar')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async descadastrar(
    @Res() res: Response,
    @Query('t') tokenQuery?: string,
    @Body() body?: { t?: string },
  ): Promise<void> {
    const token = tokenQuery ?? body?.t;
    if (!token) {
      html(res, pagina('Link inválido', 'Este link de descadastro está incompleto.'));
      return;
    }

    const r = await this.descadastro.descadastrar(token);
    if (!r.ok) {
      html(
        res,
        pagina(
          'Não deu pra concluir',
          `Não conseguimos processar este link (${r.motivo ?? 'motivo desconhecido'}). ` +
            'Responda o e-mail que a gente resolve na mão.',
        ),
      );
      return;
    }
    html(
      res,
      pagina(
        'Pronto',
        r.jaEstava
          ? 'Você já estava fora da nossa lista. Não vamos mandar mais nada.'
          : `Removemos ${r.email ? `<strong>${escapar(r.email)}</strong>` : 'seu e-mail'} da nossa lista. ` +
              'Avisos sobre pedidos que você fizer continuam chegando.',
      ),
    );
  }
}

/** Escreve a página direto na resposta — sem passar pelo envelope da API. */
function html(res: Response, corpo: string): void {
  res.status(200).type('html').send(corpo);
}

const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Página mínima e autossuficiente — sem CSS externo, sem JS, abre em qualquer lugar. */
function pagina(
  titulo: string,
  texto: string,
  tokenParaConfirmar?: string,
  acao = '/api/v1/descadastrar',
): string {
  const botao = tokenParaConfirmar
    ? `<form method="post" action="${escapar(acao)}">
         <input type="hidden" name="t" value="${escapar(tokenParaConfirmar)}">
         <button type="submit" style="background:#201554;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;cursor:pointer">
           Confirmar e não receber mais
         </button>
       </form>`
    : '';
  return `<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)}</title></head>
<body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1e293b">
  <div style="max-width:520px;margin:48px auto;padding:28px;background:#fff;border:1px solid #e2e8f0;border-radius:10px">
    <h1 style="margin:0 0 12px;font-size:20px">${escapar(titulo)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.55">${texto}</p>
    ${botao}
  </div>
</body></html>`;
}
