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

/**
 * Lacuna de TEMPLATE que o modelo copiou do exemplo — `[fonte_prospeccao]`,
 * `<nome>`, `%cidade%`, `__setor__`.
 *
 * Diferente do `placeholdersPendentes`, que pega variável NOSSA sem valor. Aqui
 * o texto veio do modelo de linguagem: o prompt usava colchete como lacuna
 * dentro de um exemplo de mensagem, e às vezes ele copiava o exemplo em vez de
 * preencher. Saiu pro representante em 2 de 6 rodadas da bateria de 08/09:
 *
 *   "A gente encontrou seu perfil [fonte_prospeccao] e fiquei interessada…"
 *
 * Não vira erro, não vira log, não vira alarme — sai bonito pro sistema e
 * quebrado pro cliente.
 *
 * **O padrão é deliberadamente estreito** pra não brigar com texto humano:
 * só token ÚNICO, minúsculo, com `_` ou `.`, sem espaço, e com ao menos 3
 * caracteres. "[1]", "[R$ 200]", "[veja o anexo]" e "<b>" passam batido de
 * propósito — o que se procura tem cara de chave de template, não de frase.
 */
export function lacunasDeExemplo(texto: string): string[] {
  const delimitado = /[[<{%]{1,2}\s*[a-z][a-z0-9_.]{2,39}\s*[\]>}%]{1,2}/g;
  // `__chave__` não tem delimitador de abrir e fechar diferentes — vai separado
  // pra não afrouxar o padrão de cima, que é o que segura o falso positivo.
  const sublinhado = /__[a-z][a-z0-9_]{1,38}__/g;
  const achados = [...texto.matchAll(delimitado), ...texto.matchAll(sublinhado)]
    .map((m) => m[0].trim())
    // `{{chave}}` é variável nossa e já tem dono: o `placeholdersPendentes`.
    .filter((bruto) => !bruto.startsWith('{{'));
  return [...new Set(achados)];
}
