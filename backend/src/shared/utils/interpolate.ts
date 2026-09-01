/**
 * Interpolação de variáveis `{{caminho.pontilhado}}` em templates de texto.
 *
 * Util ÚNICO do projeto — antes havia 3 cópias (fluxo-executor, conversar-ia,
 * campanha-envio.processor). Pura, sem deps de `@modules` (evita o ciclo de
 * import que motivou a cópia no conversar-ia).
 *
 * Comportamento de variável AUSENTE (load-bearing — não mude sem cuidado):
 *  - `ausenteVazio: false` (default): mantém o literal `{{x}}` no texto.
 *    Usado pelos fluxos/IA (um placeholder não resolvido fica visível pra debug).
 *  - `ausenteVazio: true`: troca por string vazia. Usado nas CAMPANHAS — uma
 *    variável faltando NÃO pode ir como `{{cliente.nome}}` literal pro WhatsApp
 *    do cliente final.
 *
 * Ex: `interpolate("Olá {{cliente.nome}}", { cliente: { nome: "João" } })` → "Olá João".
 */
export function interpolate(
  template: string,
  vars: unknown,
  opts: { ausenteVazio?: boolean } = {},
): string {
  const ausente = (match: string): string => (opts.ausenteVazio ? '' : match);
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, key: string) => {
    const parts = key.split('.');
    let val: unknown = vars;
    for (const part of parts) {
      if (val == null || typeof val !== 'object') return ausente(match);
      val = (val as Record<string, unknown>)[part];
    }
    return val != null ? String(val) : ausente(match);
  });
}

/**
 * Placeholders `{{x}}` que SOBRARAM depois da interpolação — ou seja, variáveis
 * que o contexto não tinha.
 *
 * Existe porque em fluxo a variável ausente MANTÉM o literal (`ausenteVazio:
 * false`, decisão deliberada acima: placeholder não resolvido fica visível pra
 * debug). Isso é bom no log e péssimo no texto que vai pro cliente — em 24/08
 * saiu uma mensagem de WhatsApp com `{{texto_teste}}` literal.
 *
 * Quem manda texto pra fora usa isto pra RECUSAR o envio em vez de entregar o
 * template cru. Não confunda com `ausenteVazio: true`: trocar por vazio também
 * é errado aqui — "na , máquina travando" não é melhor que "na {{empresa}}",
 * só é mais difícil de perceber.
 */
export function placeholdersPendentes(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{\{([\w.]+)\}\}/g)].map((m) => m[1]))];
}
