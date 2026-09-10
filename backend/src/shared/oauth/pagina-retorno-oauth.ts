/**
 * A tela que a pessoa vê quando volta do provedor externo (Google, ERP,
 * marketplace) depois de autorizar.
 *
 * É uma janela pop-up de vida curta, mas é a única parte do fluxo que a pessoa
 * lê — e até hoje eram três linhas de HTML com fonte do sistema e um check
 * verde genérico, sem marca nenhuma. Quem conecta a agenda é o REPRESENTANTE
 * do tenant, então ela segue a marca DELE, igual aos e-mails: quando o tenant
 * tem marca configurada, usa a dele; quando não tem (ou quando o erro acontece
 * antes de sabermos quem é), cai no visual do Betinna. É a mesma bifurcação que
 * o `layout()` dos e-mails já faz entre `layoutDoTenant` e `layoutGenerico`.
 *
 * **Três coisas aqui não são estética e quebram calado se alguém "melhorar":**
 *
 * 1. **O `postMessage` é o que avisa o app.** Sem ele a janela fecha e a tela
 *    de integrações continua dizendo "desconectado" até um F5. Vai com a
 *    origem explícita, nunca `'*'`.
 * 2. **Auto-fechar só no SUCESSO.** Fechar em 1,5s também no erro é como a
 *    mensagem do Google sumia antes de ser lida — a pessoa via a janela piscar
 *    e voltava pro app sem saber o que houve. No erro a janela fica, com botão.
 * 3. **Tudo escapado.** A mensagem de erro carrega texto do provedor, que é
 *    entrada externa: `escapar` no texto e `escaparAttr` em atributo.
 */

/**
 * Marca do tenant — mesma fonte dos e-mails (`Empresa.config.marca`).
 *
 * `corAcao` NÃO entra aqui de propósito. Na Somatec ela é o laranja, que o
 * brandbook reserva pra número-dinheiro / diferencial / CTA — e esta tela não
 * tem CTA nenhum, é uma confirmação. Nos e-mails o `corAcao` só pinta o botão;
 * usá-la aqui seria esticar a regra pra um lugar onde ela não vale. O acento
 * de sucesso é a `corSecundaria` (o ciano), que existe justamente pra isso.
 */
export interface MarcaPagina {
  empresaNome: string;
  logoUrl: string;
  corPrimaria: string;
  /** Ciano do tenant — o fio de acento no sucesso. */
  corSecundaria?: string;
  /** Mesma textura do cabeçalho dos e-mails, pra as duas telas se reconhecerem. */
  headerImgUrl?: string;
}

export interface PaginaRetornoParams {
  ok: boolean;
  /** Título curto — "Agenda conectada", "Não deu pra conectar". */
  titulo: string;
  /** Uma frase. No erro, é o que o provedor respondeu. */
  mensagem: string;
  /** `type` do postMessage que o front escuta (ex.: `google-oauth`). */
  canal: string;
  /** Origem exata do front — nunca `'*'`. */
  origem: string;
  marca?: MarcaPagina;
}

/** Tokens do Betinna (BRANDBOOK.md) — usados quando não há marca de tenant. */
const BETINNA = { navy: '#201554', ciano: '#2bcae5' } as const;

function escapar(s: string): string {
  return String(s).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Atributo vai entre aspas duplas: aspa e `<` são o que precisa morrer. */
function escaparAttr(s: string): string {
  return escapar(s);
}

export function paginaRetornoOAuth(p: PaginaRetornoParams): string {
  const primaria = p.marca?.corPrimaria ?? BETINNA.navy;
  // O fio embaixo do cabeçalho: ciano no sucesso, vermelho na falha. O
  // vermelho é fixo de propósito — pintar erro com a cor da empresa faz falha
  // parecer confirmação, e vermelho é vermelho em qualquer marca.
  const fio = p.ok ? (p.marca?.corSecundaria ?? BETINNA.ciano) : '#dc2626';
  // Título vermelho só quando é erro; no sucesso, o navy da marca.
  const corTitulo = p.ok ? primaria : '#dc2626';
  // Textura do cabeçalho é a MESMA imagem dos e-mails. Vai por cima da cor
  // sólida, então quem não carregar a imagem vê o navy, não branco.
  const textura = p.marca?.headerImgUrl
    ? `background-image:url('${escaparAttr(p.marca.headerImgUrl)}');background-size:cover;background-position:center;`
    : '';

  const cabecalho = p.marca
    ? `<img src="${escaparAttr(p.marca.logoUrl)}" alt="${escaparAttr(p.marca.empresaNome)}" height="34">`
    : `<span class="marca">Betinna</span>`;

  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(p.titulo)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px; background: #eef2f7;
    font-family: 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
    color: #1e293b;
  }
  .cartao { width: 100%; max-width: 420px; background: #fff; border-radius: 10px;
            overflow: hidden; box-shadow: 0 10px 30px rgba(32,21,84,.10); }
  /* A cor aqui é pro TEXTO ALTERNATIVO: a logo vem de URL configurada pelo
     tenant e pode 404. Sem isto, o nome da empresa aparece em cinza escuro
     sobre o navy do cabeçalho — ilegível justo quando algo já deu errado. */
  .topo { background-color: ${escaparAttr(primaria)}; ${textura} padding: 20px 28px;
          line-height: 0; color: #fff; font-size: 15px; font-weight: 700; }
  .topo img { display: block; height: 34px; width: auto; border: 0; }
  .marca { color: #fff; font-size: 17px; font-weight: 700; letter-spacing: .3px; line-height: 34px; }
  .corpo { padding: 32px 28px 28px; }
  h1 { margin: 0 0 10px; font-size: 19px; font-weight: 600; color: ${escaparAttr(corTitulo)}; }
  p { margin: 0; font-size: 14px; line-height: 1.6; color: #475569; }
  .nota { margin-top: 20px; font-size: 12px; color: #94a3b8; }
  button { margin-top: 22px; border: 0; border-radius: 10px; cursor: pointer;
           padding: 12px 22px; font-size: 14px; font-weight: 600; color: #fff;
           font-family: inherit; background: ${escaparAttr(primaria)}; }
</style></head>
<body>
  <main class="cartao">
    <div class="topo">${cabecalho}</div>
    <div style="height:4px;background:${escaparAttr(fio)}"></div>
    <div class="corpo">
      <h1>${escapar(p.titulo)}</h1>
      <p>${escapar(p.mensagem)}</p>
      ${
        p.ok
          ? `<p class="nota">Esta janela fecha sozinha.</p>`
          : `<button type="button" onclick="window.close()">Fechar</button>`
      }
    </div>
  </main>
<script>
  // Avisa o app ANTES de qualquer coisa: no erro a janela fica aberta pra
  // leitura, e a tela de integrações não pode ficar esperando por isso.
  try {
    if (window.opener) {
      window.opener.postMessage({ type: ${JSON.stringify(p.canal)}, ok: ${p.ok ? 'true' : 'false'} }, ${JSON.stringify(p.origem)});
    }
  } catch (e) { /* opener de outra origem: o app descobre no próximo poll */ }
  ${p.ok ? 'setTimeout(function(){ window.close(); }, 1800);' : ''}
</script>
</body></html>`;
}

/**
 * Devolve a página de retorno do OAuth com o header que o navegador exige pra
 * a janela poder se fechar.
 *
 * ⚠️ POR QUE O `COOP` PRECISA CAIR AQUI — e só aqui.
 *
 * O Helmet manda `Cross-Origin-Opener-Policy: same-origin` em tudo, por padrão
 * e com razão. Mas quando o popup do OAuth sai do provedor (accounts.google.com)
 * e aterrissa no nosso domínio, esse header **corta a relação com o opener** —
 * e aí duas coisas quebram de uma vez, sem erro nenhum na tela:
 *
 *   `window.opener` fica null   → o `postMessage` é pulado, e o app só
 *                                 descobre a conexão no próximo poll
 *   `window.close()` é BARRADO  → a janela fica aberta e a pessoa fecha na mão
 *
 * Foi medido em 10/09: o Léo autorizou o Google Agenda, a conexão funcionou
 * (`conectadoEm` carimbado), e a janela ficou parada. Não era a lógica da
 * página — era o header. E não era regressão: o `window.close()` está nesses
 * controllers desde o commit inicial, então nunca funcionou. Só apareceu quando
 * alguém finalmente ASSISTIU à tela, gravando o vídeo de verificação do Google.
 *
 * `unsafe-none` fica restrito à rota de callback, que é o escopo mínimo: a
 * página não tem estado sensível nem interação além do botão de fechar. É o
 * requisito documentado pra popup de OAuth, não um relaxamento oportunista.
 */
export function enviarPaginaRetorno(
  res: { setHeader(k: string, v: string): void; status(c: number): unknown },
  status: number,
  html: string,
): void {
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  const r = res.status(status) as { type(t: string): { send(b: string): void } };
  r.type('html').send(html);
}
