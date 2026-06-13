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
