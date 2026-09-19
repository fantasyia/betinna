/**
 * O que este lead JÁ informou, dito ao modelo como FATO — fora do prompt grande.
 *
 * O defeito que isto conserta: lead que já tinha dado a tensão respondia a
 * corrente e era perguntado sobre a tensão de novo (9 reproduções em 18/09,
 * casos COB.2/COB.3). Tudo o que deveria impedir isso funcionava: o valor
 * estava em `Lead.variaveis.tensao_rede`, o EXTRAIR_VARIAVEIS faz merge e não
 * apaga, o portão do grafo respondia "Sim, já sabemos" corretamente, e a
 * variável chegava renderizada no prompt (`| tensão | **220V** |`). Quem
 * perguntava era a própria IA consultiva, com o valor na mão.
 *
 * 🔴 Por que o conserto NÃO é de texto: o prompt do C1 tem 47 mil caracteres e
 * NOVE menções mandando perguntar a tensão, incluindo seções inteiras ("SEM A
 * TENSÃO NÃO EXISTE MODELO"). Uma regra nova escrita lá dentro entra como uma
 * voz contra nove — foi exatamente o que a tentativa v61 provou ao reprovar
 * igual, com o texto novo no lugar.
 *
 * O motor já resolvia esse mesmo problema por outra via, e duas vezes: o nome
 * do contato e o e-mail ganham uma linha `[Dado]` curta anexada DEPOIS do
 * prompt compilado, e o comentário de uma delas já registra o sintoma idêntico
 * ("sem repetir a regra aqui, a IA pescava o nome do histórico"). O que faltava
 * era ligar o mesmo mecanismo nas variáveis que conduzem a conversa. Este
 * arquivo é isso.
 *
 * 📌 E ser CÓDIGO é o que destrava o conserto. A via de prompt estava bloqueada
 * por um efeito colateral: `interpolate` roda com `ausenteVazio: false`, e como
 * nenhuma das variáveis do EXTRAIR_VARIAVEIS é `VariavelCustomizada`, um
 * `{{custom.corrente_quadro}}` iria CRU pro prompt numa conversa nova. Aqui o
 * problema não existe: só entra na string a variável que TEM valor.
 */

/** Teto de itens listados. Acima disso o bloco vira ruído e compete com o prompt. */
const MAX_ITENS = 20;
/** Teto por valor. Variável de lead aceita texto livre; um parágrafo colado aqui empurra o resto pra fora. */
const MAX_VALOR = 200;

/**
 * Um valor só conta como "o lead informou" se for escalar e não-vazio.
 *
 * Objeto e array ficam de fora de propósito: em `Lead.variaveis` eles são
 * estrutura interna (histórico, payload de gatilho), não algo que a pessoa
 * disse — e serializados viram um bloco enorme dentro do system prompt.
 */
function valorDizivel(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t.slice(0, MAX_VALOR) : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  return null;
}

/**
 * Monta o bloco `[Dado]` com o que o lead já informou.
 *
 * @param variaveisDoLead `Lead.variaveis` cru (jsonb) — NÃO use `ctx.custom`:
 *   ele é `{...defaults da empresa, ...variáveis do lead}`, e um default da
 *   empresa apresentado como "a pessoa já te disse" é uma mentira dita ao
 *   modelo com a mesma cara de verdade que o resto do bloco.
 * @param opts.reservada chaves internas (`_*`, ids) — a MESMA regex que a
 *   gravação usa; recebida de fora pra não nascer uma segunda lista que
 *   diverge da primeira em silêncio.
 * @param opts.ignorar sinais de ROTEAMENTO (classificacao_final, trilho…):
 *   são decisão do motor, não fala do lead, e são limpos entre abordagens.
 */
export function instrucaoDadosJaInformados(
  variaveisDoLead: unknown,
  opts: { reservada?: RegExp; ignorar?: readonly string[] } = {},
): string {
  if (!variaveisDoLead || typeof variaveisDoLead !== 'object' || Array.isArray(variaveisDoLead)) {
    return '';
  }
  const ignorar = new Set<string>(opts.ignorar ?? []);
  const linhas: string[] = [];
  for (const [chave, bruto] of Object.entries(variaveisDoLead as Record<string, unknown>)) {
    if (ignorar.has(chave)) continue;
    if (opts.reservada?.test(chave)) continue;
    const valor = valorDizivel(bruto);
    if (valor === null) continue;
    linhas.push(`\n- ${chave}: ${valor}`);
    if (linhas.length >= MAX_ITENS) break;
  }
  if (!linhas.length) return '';

  // A regra vem DEPOIS da lista, e manda CONFIRMAR em vez de só proibir
  // perguntar: "não pergunte" sozinho deixa o modelo sem saída quando ele
  // precisa checar um valor duvidoso, e aí ele pergunta do mesmo jeito.
  return (
    '\n[Dado] Este lead JÁ informou o seguinte — o valor é conhecido, NÃO pergunte nenhum ' +
    'destes de novo:' +
    linhas.join('') +
    '\n[Regra] Isto vale ACIMA de qualquer instrução do prompt que mande perguntar um destes ' +
    'dados. Se precisar checar algum, CONFIRME citando o valor ("você falou 220V, certo?") — ' +
    'nunca pergunte como se não soubesse.'
  );
}
