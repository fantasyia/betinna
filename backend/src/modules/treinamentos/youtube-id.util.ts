/**
 * Extrai o ID do vídeo de uma URL do YouTube.
 *
 * Existe porque ninguém cola um ID: cola a barra de endereços, o "Compartilhar",
 * ou o código do `<iframe>` inteiro. Guardar a URL crua em vez do ID seria pior —
 * cada forma monta um embed diferente, e a que vem de `watch?v=` nem embeda.
 *
 * 📌 Guardamos o ID, não a URL. O embed é montado por nós, sempre igual.
 *
 * ⚠️ ACEITA vídeo "Não listado" e é isso que se quer aqui: ele não aparece em
 * busca nem no canal, mas EMBEDA normalmente. Vídeo "Privado" não embeda — quem
 * abrir a aba vê "vídeo indisponível" —, e isso não dá pra detectar pela URL:
 * as duas são idênticas. Se o treinamento não aparecer, é o primeiro lugar a
 * olhar.
 */

/** Um ID do YouTube tem 11 caracteres do alfabeto base64url. */
const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * As formas que aparecem de verdade quando alguém copia do YouTube.
 *
 * `shorts` e `live` entram porque um treinamento curto gravado no celular vira
 * short sem ninguém escolher isso.
 */
/**
 * ⚠️ O `(?![A-Za-z0-9_-])` no fim não é enfeite: sem ele, um `v=` com 16
 * caracteres casaria os 11 PRIMEIROS e devolveria um ID que parece válido e
 * aponta pra outro vídeo. Errar por sobra é pior que não achar, porque ninguém
 * duvida de um resultado.
 */
const FIM = '(?![A-Za-z0-9_-])';
const PADROES: RegExp[] = [
  new RegExp(`[?&]v=([A-Za-z0-9_-]{11})${FIM}`), // watch?v=ID (com &t=, &list=…)
  new RegExp(`youtu\\.be/([A-Za-z0-9_-]{11})${FIM}`), // encurtado do Compartilhar
  new RegExp(`/embed/([A-Za-z0-9_-]{11})${FIM}`), // colou o <iframe> inteiro
  new RegExp(`/shorts/([A-Za-z0-9_-]{11})${FIM}`),
  new RegExp(`/live/([A-Za-z0-9_-]{11})${FIM}`),
  new RegExp(`/v/([A-Za-z0-9_-]{11})${FIM}`), // formato antigo
];

/**
 * O ID, ou `null` quando não dá pra ter certeza.
 *
 * ⛔ Não chuta. Um ID errado gera um embed que carrega em silêncio e mostra
 * "vídeo indisponível" — ou, pior, o vídeo de outra pessoa. Recusar na hora do
 * cadastro é a única chance de alguém perceber.
 */
export function extrairYoutubeId(bruto: string | null | undefined): string | null {
  if (typeof bruto !== 'string') return null;
  const texto = bruto.trim();
  if (!texto) return null;

  // Já é um ID puro.
  if (ID.test(texto)) return texto;

  for (const padrao of PADROES) {
    const m = padrao.exec(texto);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * A URL do player.
 *
 * `youtube-nocookie.com` é deliberado: o domínio normal planta cookie de
 * rastreio do Google em todo funcionário que abrir a aba, sem que ninguém tenha
 * escolhido isso. O modo sem cookie serve o mesmo vídeo.
 */
export function urlDeEmbed(youtubeId: string): string {
  return `https://www.youtube-nocookie.com/embed/${youtubeId}`;
}

/** A miniatura, servida pelo YouTube — não passa pelo nosso servidor. */
export function urlDaMiniatura(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`;
}
