import type { VariavelGravavel } from './variaveis-gravadas.util';
import { ehNaoSei } from './normalizar-valor.util';

/**
 * Rede de segurança SEM modelo pros campos que o portão do fluxo lê.
 *
 * 🔴 O problema que isto existe pra resolver, medido em 11/09: o nó declara 5
 * variáveis, o turno responde bem, e às vezes grava ZERO. O portão seguinte lê
 * `custom.tensao_rede` vazio e o TEXTO FIXO pergunta a tensão que a pessoa
 * acabou de dizer. Taxa medida: 1 em 10 primeiros contatos.
 *
 * ⚠️ **Melhorar o prompt não fecha isso.** Extração por LLM é não-determinística
 * por construção — dá pra empurrar a taxa pra baixo, nunca pra zero. Enquanto o
 * único caminho até o portão passar pelo modelo, existe uma fração de clientes
 * ouvindo de novo o que acabou de responder.
 *
 * Esta função é o caminho que NÃO passa pelo modelo. Ela lê a fala da pessoa e
 * decide por regra: "220V" é 220V, e não depende de nenhuma chamada dar certo.
 *
 * 📌 Ela só PREENCHE LACUNA — nunca sobrescreve o que o modelo trouxe. O modelo
 * viu a conversa inteira; isto aqui viu uma frase. Quando os dois têm opinião, a
 * do modelo vale. Isto entra exatamente onde hoje não entra nada.
 *
 * ⛔ E ela é deliberadamente CONSERVADORA: na dúvida não grava. Um campo vazio
 * faz o bot perguntar (chato); um campo ERRADO manda o cliente pra um produto
 * que não protege a instalação dele. Os dois custos não são simétricos, então a
 * régua é "só grava o que dá pra provar pela frase".
 */

/** Tensões que existem em campo no Brasil. Fora desta lista, não é tensão. */
const TENSOES = ['110', '127', '220', '380', '440'] as const;

/**
 * "110" é como a maior parte do Brasil chama a rede de **127V** — é a mesma
 * tomada, e o próprio TEXTO FIXO do fluxo oferece "110V" como opção. Sem este
 * mapa, quem responde exatamente o que o bot perguntou não tem valor possível no
 * enum (`127V | 220V | 380V | 440V | nao sei`) e é perguntado de novo.
 *
 * ⚠️ Só mapeia quando `110V` NÃO está entre os valores aceitos do nó. Se algum
 * fluxo declarar `110V` de propósito, o valor declarado manda.
 */
const COLOQUIAL: Record<string, string> = { '110': '127' };

/** Depois do número, isto prova que NÃO é tensão. */
const NAO_E_TENSAO =
  /^\s*(a\b|amp|ampere|litro|l\b|metro|m\b|m2|m²|watt|w\b|kw|rs|reais|r\$|ano|hz|%)/i;
/** Depois do número, isto prova que NÃO é corrente. */
const NAO_E_CORRENTE =
  /^\s*(v\b|volt|litro|l\b|metro|m\b|m2|m²|watt|w\b|kw|rs|reais|r\$|ano|hz|%)/i;

/** Palavras que, perto do número, dizem que ele é uma TENSÃO. */
const PISTA_TENSAO =
  /(tens[ãa]o|volts?|rede|padr[ãa]o|energia|monof[áa]sic|bif[áa]sic|trif[áa]sic|f[áa]sic)/i;
/** Palavras que, perto do número, dizem que ele é uma CORRENTE. */
const PISTA_CORRENTE = /(disjuntor|geral|quadro|corrente|amp[eè]?r|chave|breaker)/i;

/**
 * O que pode seguir um número SOLTO sem desmenti-lo como resposta.
 *
 * 🔴 Sem isto, o convite da pergunta aceitava qualquer número solto — e a
 * varredura de 24 redações (11/09) achou dois falsos positivos:
 *
 * ```
 * "sao 220 clientes por dia"  → 220V   🔴
 * "moro no 220 da rua"        → 220V   🔴
 * ```
 *
 * A checagem de unidade não pega esses: ela veta "litros" e "metros", mas
 * "clientes" e "da rua" não são unidade de nada.
 *
 * ⚠️ São frases implausíveis como resposta a "qual o padrão de energia?" — e
 * essa era a única proteção. **Implausível não é impossível**, e o dano é
 * assimétrico: gravar 220V errado manda a pessoa pra uma calculadora
 * dimensionada na tensão errada, e ela não tem como saber. É pior que
 * perguntar de novo.
 *
 * Então a resposta tem que ACABAR no número, ou seguir com palavra que não
 * muda o que ele é: "deve ser 220 mesmo", "380 trifasica", "tem um de 60 ali".
 */
const DEPOIS_NEUTRO = new RegExp(
  [
    'mesmo',
    'a[ií]',
    'aqui',
    'ali',
    'ent[ãa]o',
    'n[ée]',
    'sim',
    'ok',
    'certo',
    'acho',
    'volts?',
    'v',
    'a',
    'amp\\w*',
    '(tri|bi|mono)f[áa]sic\\w*',
  ]
    .map((x) => '^(?:' + x + ')\\b')
    .join('|'),
  'i',
);

/** O que sobra depois do número, sem a pontuação que só fecha a frase. */
const restoDepois = (depois: string): string => depois.replace(new RegExp('^[\\s.,;:!?)-]+'), '');

/** Janela de contexto à esquerda do número onde uma pista ainda conta. */
const JANELA = 32;

/** Corrente de disjuntor plausível. Fora disto é outro número qualquer. */
const CORRENTE_MIN = 5;
const CORRENTE_MAX = 4000;

type Achado = { valor: string; trecho: string };

/** A pergunta do bot que convida um NÚMERO SOLTO como resposta. */
export type Convite = 'tensao' | 'corrente' | null;

/**
 * ⚠️ Montadas a partir de STRING, e não escritas como literal.
 *
 * A versão literal desta linha nasceu com um byte de BACKSPACE (0x08) no
 * lugar do \\b de borda de palavra — invisível no editor, invisível no
 * `grep`, e a alternativa "letra a" simplesmente nunca casava. Só apareceu
 * rodando a rota de diagnóstico contra produção.
 *
 * 📌 Segunda vez que um escape invisível entra numa regex deste repo por
 * edição via script. Montar de string torna o escape explícito e o byte
 * impossível de errar em silêncio.
 */
const PERGUNTOU_TENSAO = new RegExp(
  ['tens[ãa]o', 'padr[ãa]o de energia', 'volts?', '1[12]0 ?v', '220 ?v', '380 ?v', '440 ?v'].join(
    '|',
  ),
  'i',
);
const PERGUNTOU_CORRENTE = new RegExp(
  ['disjuntor', 'corrente', 'quadro de luz', 'letra a\\b', 'amp[eè]?r'].join('|'),
  'i',
);

/**
 * O que a última fala do BOT convida como resposta.
 *
 * 🔴 É isto que torna seguro aceitar número solto. Medido em 11/09 15:08: o
 * bot pergunta *"110V, 220V ou 380V?"* e a pessoa responde **"220"** — a
 * copy CONVIDA ao número solto, então ele não é caso raro, é o caso que a
 * pergunta produz. O mesmo vale pra corrente: o texto pede *"um número
 * seguido da letra A"* e vem **"63"**.
 *
 * ⚠️ Sem o contexto, aceitar número solto faria "sao 220 clientes por dia"
 * virar 220V. Com ele, essa frase nunca aparece: ela não é resposta a "qual
 * o padrão de energia?". **O contexto não é uma proteção a mais — é o que
 * torna a regra segura.**
 *
 * ⛔ Pergunta que puxa os DOIS devolve `null`: número solto ali é ambíguo, e
 * ambiguidade volta pro caminho conservador.
 */
export function conviteDaPergunta(ultimaFalaDoBot: string | undefined): Convite {
  if (!ultimaFalaDoBot) return null;
  const t = PERGUNTOU_TENSAO.test(ultimaFalaDoBot);
  const c = PERGUNTOU_CORRENTE.test(ultimaFalaDoBot);
  if (t && c) return null;
  if (t) return 'tensao';
  if (c) return 'corrente';
  return null;
}

/** Percorre os números do texto uma vez só, com o contexto de cada um. */
function* numerosComContexto(texto: string): Generator<{
  num: string;
  antes: string;
  depois: string;
}> {
  const re = /\d{1,4}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    yield {
      num: m[0],
      antes: texto.slice(Math.max(0, m.index - JANELA), m.index),
      depois: texto.slice(m.index + m[0].length, m.index + m[0].length + 12),
    };
  }
}

/**
 * A tensão dita na frase, ou null.
 *
 * Exige âncora: ou a unidade colada no número ("220V"), ou uma pista de tensão
 * logo antes ("a rede aqui é 220"). Número solto NÃO vira tensão — foi assim que
 * "freezer de 220 litros" deixou de virar 220V.
 */
export function tensaoNaFrase(texto: string, aceitarSolto = false): Achado | null {
  for (const { num, antes, depois } of numerosComContexto(texto)) {
    if (!(TENSOES as readonly string[]).includes(num)) continue;
    if (NAO_E_TENSAO.test(depois)) continue;
    const temUnidade = /^\s*(v\b|volts?)/i.test(depois);
    const temPista = PISTA_TENSAO.test(antes);
    if (!temUnidade && !temPista) {
      if (!aceitarSolto) continue;
      const resto = restoDepois(depois);
      if (resto !== '' && !DEPOIS_NEUTRO.test(resto)) continue;
    }
    return { valor: num, trecho: (antes.slice(-16) + num + depois.slice(0, 4)).trim() };
  }
  return null;
}

/**
 * A corrente do disjuntor dita na frase, ou null.
 *
 * Mesma régua da tensão: unidade colada ("63A") ou pista perto ("o disjuntor
 * geral é 63"). E a tensão VETA — "220V" nunca vira corrente de 220A.
 */
export function correnteNaFrase(texto: string, aceitarSolto = false): Achado | null {
  for (const { num, antes, depois } of numerosComContexto(texto)) {
    if (NAO_E_CORRENTE.test(depois)) continue;
    const n = Number(num);
    if (!Number.isFinite(n) || n < CORRENTE_MIN || n > CORRENTE_MAX) continue;
    const temUnidade = /^\s*(a\b|amp|amper)/i.test(depois);
    const temPista = PISTA_CORRENTE.test(antes);
    if (!temUnidade && !temPista) {
      if (!aceitarSolto) continue;
      const resto = restoDepois(depois);
      if (resto !== '' && !DEPOIS_NEUTRO.test(resto)) continue;
    }
    // Número que é claramente a tensão não é a corrente, mesmo com "quadro"
    // ou "disjuntor" na mesma frase — e eles costumam vir na mesma frase.
    if (!temUnidade && (TENSOES as readonly string[]).includes(num) && PISTA_TENSAO.test(antes)) {
      continue;
    }
    // ⚠️ SÓ O NÚMERO, sem o "A" — é o formato que o prompt do C1-L declara
    // (`corrente` — só o número, em ampères. `63`, não `63A`) e o que o modelo
    // grava. Duas fontes escrevendo o mesmo campo com formatos diferentes é a
    // mesma família de defeito que os contratos desalinhados de `tensao_rede`:
    // o nó que monta o link leria `63A` e poderia mandar `corrente=63A`, que a
    // calculadora não parseia — e só no caminho raro em que a rede dispara.
    return { valor: `${n}`, trecho: (antes.slice(-16) + num + depois.slice(0, 4)).trim() };
  }
  return null;
}

/**
 * O que dá pra afirmar a partir da frase, limitado ao que o nó declarou e ao que
 * ainda está faltando.
 *
 * @param declaradas o que o nó pediu pra gravar (com os valores aceitos)
 * @param texto      a fala da pessoa neste turno
 * @param jaTem      o que já existe (modelo deste turno + o que o lead tinha)
 */
export function extrairDeterministico(
  declaradas: VariavelGravavel[],
  texto: string,
  jaTem: Record<string, unknown>,
  /** O que a última pergunta do bot convida — ver `conviteDaPergunta`. */
  convite: Convite = null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!texto || !texto.trim()) return out;

  /**
   * ⚠️ `nao sei` CONTA COMO LACUNA — e isto é o mesmo princípio que a gravação
   * já aplica na outra direção.
   *
   * O código trata "não sei" como AUSÊNCIA justamente pra ele não apagar um
   * valor concreto ("ausência não apaga presença", medido em 07/09). Se é
   * ausência lá, é ausência aqui: um campo em `nao sei` é exatamente onde a
   * rede tem o que fazer.
   *
   * 🔴 Medido em 11/09 15:02, e não é caso de borda: a pessoa escreveu
   * *"acho que e 110 volts aqui, e o padrao antigo mesmo"*. **Ela deu o
   * número.** O modelo leu o "acho que" e gravou `nao sei`; o link saiu sem
   * tensão e mandou ela escolher na página o que tinha acabado de dizer.
   *
   * Hesitar ao falar de elétrica é como gente não-técnica fala — que é
   * exatamente o público deste fluxo. Tratar hesitação como ausência de
   * informação joga fora o dado de quem mais precisa de ajuda.
   */
  const falta = (nome: string): boolean => {
    if (!declaradas.some((d) => d.nome === nome)) return false;
    const v = jaTem[nome];
    return v == null || String(v).trim() === '' || ehNaoSei(v);
  };
  const aceitos = (nome: string): string[] | undefined =>
    declaradas.find((d) => d.nome === nome)?.valores;

  if (falta('tensao_rede')) {
    const achado = tensaoNaFrase(texto, convite === 'tensao');
    if (achado) {
      const lista = aceitos('tensao_rede');
      // Respeita o enum do nó: só grava valor que ele aceita. Inventar um valor
      // fora da lista quebraria o roteador, que compara por texto literal.
      const candidatos = [`${achado.valor}V`, `${COLOQUIAL[achado.valor] ?? achado.valor}V`];
      const escolhido = lista ? candidatos.find((c) => lista.includes(c)) : candidatos[0];
      if (escolhido) out.tensao_rede = escolhido;
    }
  }

  if (falta('corrente_quadro')) {
    const achado = correnteNaFrase(texto, convite === 'corrente');
    // `corrente_quadro` é campo livre no C1; se algum fluxo declarar lista, a
    // mesma regra vale — não grava o que o nó não aceita.
    if (achado) {
      const lista = aceitos('corrente_quadro');
      if (!lista || lista.includes(achado.valor)) out.corrente_quadro = achado.valor;
    }
  }

  return out;
}
