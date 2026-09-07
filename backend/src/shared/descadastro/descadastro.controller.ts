import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
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
 * Responde HTML cru em vez do envelope padrão da API porque quem abre isto é uma
 * pessoa no navegador, não um cliente de API.
 */
@ApiExcludeController()
@Controller()
export class DescadastroController {
  constructor(private readonly descadastro: DescadastroService) {}

  @Public()
  @Get('descadastrar')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  paginaConfirmar(@Query('t') token?: string): string {
    if (!token) return pagina('Link inválido', 'Este link de descadastro está incompleto.');
    return pagina(
      'Cancelar os e-mails',
      'Confirme abaixo e você não recebe mais nossos e-mails de novidades e acompanhamento. ' +
        'Avisos sobre um pedido que você fez (confirmação, nota, rastreio) continuam chegando.',
      token,
    );
  }

  /**
   * Descadastra. Aceita o token na query (one-click do provedor) ou no corpo do
   * formulário (botão da página).
   */
  @Public()
  @Post('descadastrar')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async descadastrar(
    @Query('t') tokenQuery?: string,
    @Body() body?: { t?: string },
  ): Promise<string> {
    const token = tokenQuery ?? body?.t;
    if (!token) return pagina('Link inválido', 'Este link de descadastro está incompleto.');

    const r = await this.descadastro.descadastrar(token);
    if (!r.ok) {
      return pagina(
        'Não deu pra concluir',
        `Não conseguimos processar este link (${r.motivo ?? 'motivo desconhecido'}). ` +
          'Responda o e-mail que a gente resolve na mão.',
      );
    }
    return pagina(
      'Pronto',
      r.jaEstava
        ? 'Você já estava fora da nossa lista. Não vamos mandar mais nada.'
        : `Removemos ${r.email ? `<strong>${escapar(r.email)}</strong>` : 'seu e-mail'} da nossa lista. ` +
            'Avisos sobre pedidos que você fizer continuam chegando.',
    );
  }
}

const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Página mínima e autossuficiente — sem CSS externo, sem JS, abre em qualquer lugar. */
function pagina(titulo: string, texto: string, tokenParaConfirmar?: string): string {
  const botao = tokenParaConfirmar
    ? `<form method="post" action="/api/v1/descadastrar">
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
