/**
 * Tira da URL os segredos que viajam no CAMINHO.
 *
 * O webhook do Tiny é a exceção ao D11: o ERP não assina os eventos — não
 * manda HMAC nem header de autenticação. Sobra o que o painel dele deixa
 * configurar, que é a própria URL. Por isso o segredo mora num segmento do
 * caminho, e ele é a autenticação INTEIRA daquele endpoint.
 *
 * O efeito colateral é que todo lugar que ecoa `request.url` publica a
 * credencial: o `meta.path` da resposta, o `meta.path` do erro, o log de HTTP
 * do Railway e o breadcrumb do Sentry. Qualquer um desses vira um jeito de
 * pegar o segredo sem precisar do painel.
 *
 * Redigir aqui não substitui rotacionar um segredo já exposto — só para de
 * abrir portas novas.
 */
const CAMINHOS_COM_SEGREDO = [
  // /api/v1/webhooks/tiny/<segredo>/<evento> — o evento fica, que é o que
  // interessa pra ler o log; some só o segmento do meio.
  /(\/webhooks\/tiny\/)[^/?#]+/gi,
];

export function redigirCaminho(url: string): string {
  let saida = url;
  for (const rx of CAMINHOS_COM_SEGREDO) saida = saida.replace(rx, '$1[REDACTED]');
  return saida;
}
