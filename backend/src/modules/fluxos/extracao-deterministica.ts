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
 * Palavras que podem acompanhar a resposta sem mudar o que o número É.
 *
 * É o vocabulário que define "a mensagem inteira é a resposta" — ver
 * `mensagemEhSoAResposta`, que explica por que a régua é essa.
 *
 * ⚠️ Lista deliberadamente CURTA. Cada palavra a mais aqui alarga a porta por
 * onde entra número solto, e foi por essa porta que "sao 220 clientes por dia" e
 * "o numero do predio e 220" viraram 220V nas duas varreduras de 11/09.
 *
 * ⛔ Não acrescente substantivo que possa ser SUJEITO da frase ("prédio",
 * "andar", "cliente"): é justamente ele que denuncia que o número é de outro
 * assunto.
 */
const SO_RECHEIO = new RegExp(
  '^(?:' +
    [
      'e',
      'eh',
      'é',
      'de',
      'do',
      'da',
      'o',
      'os',
      'as',
      'a',
      'aqui',
      'a[ií]',
      'ali',
      'em',
      'na',
      'no',
      'casa',
      'acho',
      'que',
      'deve',
      'ser',
      'mesmo',
      'sim',
      'ok',
      'certo',
      'ent[ãa]o',
      'n[ée]',
      'tem',
      'um',
      'uma',
      'uns',
      'volts?',
      'v',
      'amp\\w*',
      '(tri|bi|mono)f[áa]sic\\w*',
      'rede',
      'tens[ãa]o',
      'padr[ãa]o',
      'energia',
      'tomada',
      'normal',
    ].join('|') +
    ')$',
  'i',
);

/**
 * 🔴 A mensagem INTEIRA é a resposta, ou o número está no meio de outro assunto?
 *
 * A regra anterior olhava só o que vinha DEPOIS do número, e por isso deixava
 * passar o caso que a varredura de 19 frases achou (11/09):
 *
 * ```
 * "o numero do predio e 220"   → 220V   🔴   ← acaba no número!
 * "somos 380 no predio"        → 380V   🔴
 * "trabalho aqui ha 127 dias"  → 127V   🔴
 * ```
 *
 * ⚠️ **O sinal não está depois do número, está antes** — *"o padrão é 220"* e
 * *"o número do prédio é 220"* têm exatamente a mesma forma no fim. E enumerar
 * os substantivos que competem (prédio, andar, dias, clientes, funcionários…) é
 * lista infinita: sempre falta um, e o que falta grava errado calado.
 *
 * Então a régua inverte. O bot fez uma pergunta FECHADA, e a resposta natural é
 * curta: tirando o número, o que sobra tem que ser só enchimento. Frase que
 * carrega sujeito próprio não é resposta — é outro assunto com um número dentro.
 *
 * 📌 Custa alguns legítimos verbosos ("220 na tomada da cozinha"), e o custo é
 * aceitável: ali a rede se cala e o MODELO responde, que é o caminho normal.
 * Perder uma captura é perguntar de novo; gravar errado é dimensionar errado sem
 * ninguém saber.
 */
function mensagemEhSoAResposta(texto: string, num: string): boolean {
  const semNumero = texto.replace(num, ' ');
  const palavras = semNumero.split(new RegExp('[^\\p{L}]+', 'u')).filter(Boolean);
  return palavras.every((p) => SO_RECHEIO.test(p));
}

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
  const achados: Achado[] = [];
  for (const { num, antes, depois } of numerosComContexto(texto)) {
    if (!(TENSOES as readonly string[]).includes(num)) continue;
    if (NAO_E_TENSAO.test(depois)) continue;
    const temUnidade = /^\s*(v\b|volts?)/i.test(depois);
    const temPista = PISTA_TENSAO.test(antes);
    if (!temUnidade && !temPista) {
      if (!aceitarSolto) continue;
      if (!mensagemEhSoAResposta(texto, num)) continue;
    }
    achados.push({ valor: num, trecho: (antes.slice(-16) + num + depois.slice(0, 4)).trim() });
  }
  // ── DUAS TENSÕES DIFERENTES = a pessoa NÃO decidiu, e a rede também não ──
  //
  // 🔴 Medido em 11/09: `"110 ou 220, nao sei bem"` gravava 127V. A pessoa está
  // literalmente dizendo que não sabe, e o resultado era uma calculadora
  // dimensionada num chute — **pior que não gravar nada**, porque ninguém fica
  // sabendo que foi chute.
  //
  // ⚠️ E `"tem 220 e 380 aqui"` não é frase adversarial: quadro de comércio com
  // dois padrões é caso real. Escolher o primeiro é inventar uma decisão que a
  // frase não tomou.
  //
  // Calando, o campo fica vazio ou `nao sei` — e o portão já deixa `nao sei`
  // passar pro link, que abre com a tensão em aberto pra ela escolher.
  if (new Set(achados.map((a) => a.valor)).size > 1) return null;
  return achados[0] ?? null;
}

/**
 * A corrente do disjuntor dita na frase, ou null.
 *
 * Mesma régua da tensão: unidade colada ("63A") ou pista perto ("o disjuntor
 * geral é 63"). E a tensão VETA — "220V" nunca vira corrente de 220A.
 */
export function correnteNaFrase(texto: string, aceitarSolto = false): Achado | null {
  const achados: Achado[] = [];
  for (const { num, antes, depois } of numerosComContexto(texto)) {
    if (NAO_E_CORRENTE.test(depois)) continue;
    const n = Number(num);
    if (!Number.isFinite(n) || n < CORRENTE_MIN || n > CORRENTE_MAX) continue;
    const temUnidade = /^\s*(a\b|amp|amper)/i.test(depois);
    const temPista = PISTA_CORRENTE.test(antes);
    if (!temUnidade && !temPista) {
      if (!aceitarSolto) continue;
      if (!mensagemEhSoAResposta(texto, num)) continue;
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
    achados.push({ valor: `${n}`, trecho: (antes.slice(-16) + num + depois.slice(0, 4)).trim() });
  }
  // Mesma regra da tensão: duas correntes diferentes na frase é ambiguidade, e a
  // rede não desempata ("tem um de 63 e outro de 40").
  if (new Set(achados.map((a) => a.valor)).size > 1) return null;
  return achados[0] ?? null;
}

/**
 * O que dá pra afirmar a partir da frase, limitado ao que o nó declarou e ao que
 * ainda está faltando.
 *
 * @param declaradas o que o nó pediu pra gravar (com os valores aceitos)
 * @param texto      a fala da pessoa neste turno
 * @param jaTem      o que já existe (modelo deste turno + o que o lead tinha)
 */
/**
 * O TIPO DE LOCAL dito na frase — ou null.
 *
 * ⚠️ É o campo de maior custo de erro da rede: `perfil_cliente` decide a PÁGINA
 * do link (proteção comercial × residencial). Errar a tensão a pessoa ainda vê
 * o número na tela; errar o local manda ela pra uma página que ela nem sabe que
 * tem alternativa. Por isso a régua aqui é a mais dura das três:
 *
 *   - só palavra INTEIRA (borda), nunca substring;
 *   - frases compostas de comércio ("casa de bolos", "casa de carnes") são
 *     resolvidas ANTES e mascaradas — senão "casa" as puxaria pra residência;
 *   - DUAS categorias na mesma frase = a rede se cala ("a padaria do meu
 *     condomínio", "carregador na minha casa"). Quem desempata é o modelo, que
 *     viu a conversa inteira.
 *
 * O vocabulário é o da tabela do prompt do C1-L (padaria/mercado/loja →
 * comércio; casa/apartamento → residência…) — a mesma lista que o modelo é
 * instruído a usar. Autorizado pelo Léo em 12/09, depois de a rede ter
 * convertido uma falha TOTAL em parcial numa conversa real: tensão e corrente
 * salvas, e a pessoa ainda passou pelo consultivo só por causa deste campo.
 */
// ⚠️ Montadas de STRING com o escape explícito: a versão em literal nasceu com
// byte de BACKSPACE no lugar do \\b — terceira vez neste arquivo. `od -c` pega;
// editor e grep não.
const rx = (fonte: string): RegExp => new RegExp(fonte, 'i');
/** Sentinela: a frase é sobre um local, mas não dá pra dizer QUAL. Abstém. */
const AMBIGUO = '__ambiguo__';
const PERFIL_FRASES: Array<[RegExp, string]> = [
  // compostos que carregam 'casa' — resolvidos primeiro e mascarados
  [rx('\\bcasa de (bolos?|carnes?|ra[çc][ãa]o|festas?|massas?|p[ãa]es|sucos?)\\b'), 'comercio'],
  [rx('\\bcasa (noturna|de shows?)\\b'), 'comercio'],
  [rx('\\bcasa de (praia|campo|veraneio|fim de semana)\\b'), 'residencia'],
  // ⚠️ Qualquer OUTRO 'casa de/da/do X' abstém. A varredura de 12/09 achou
  // 'casa de máquinas' (é o quadro do PRÉDIO) caindo em residência porque o
  // default de 'casa' era residência e a lista de compostos é enumeração —
  // todo composto novo nascia errado. Invertido: o default do composto é
  // 'não sei', e só as duas listas acima resolvem. Pega de graça 'casa da
  // minha mãe' (local de outro), que também não deve preencher.
  [rx('\\bcasa d[aeo]s? \\S+'), AMBIGUO],
  [rx('\\bponto comercial\\b'), 'comercio'],
  [rx('\\b(carro|ve[ií]culo) el[ée]trico\\b'), 'carro_eletrico'],
  [rx('\\b[áa]rea comum\\b'), 'condominio'],
  // 'morador' só conta ACOMPANHADO: 'morador de rua' não é morador de
  // condomínio (varredura 4, 12/09) — terceira instância da classe 'casa de
  // máquinas': palavra cujo sentido vira pelo que vem depois. Sozinho, abstém.
  [
    rx('\\bmorador(es|a|as)? d[oa]s? (pr[ée]dio|condom[íi]nio|edif[íi]cio|bloco|conjunto)\\b'),
    'condominio',
  ],
];
const PERFIL_PALAVRAS: Array<[RegExp, string]> = [
  [
    rx(
      '\\b(loja|padaria|mercad(o|inho)|supermercado|restaurante|lanchonete|farm[áa]cia|cl[íi]nica|' +
        'consult[óo]rio|escrit[óo]rio|oficina|sal[ãa]o|a[çc]ougue|bar|pizzaria|hotel|pousada|academia|' +
        'petshop|pet shop|conveni[êe]ncia|com[ée]rcio|comercial|empresa|f[áa]brica)\\b',
    ),
    'comercio',
  ],
  [
    rx('\\b(casa|apartamento|ap[êe]|s[íi]tio|ch[áa]cara|resid[êe]ncia|residencial)\\b'),
    'residencia',
  ],
  [rx('\\b(condom[íi]nio|s[íi]ndic[oa])\\b'), 'condominio'],
  [rx('\\b(carregador(es)?|eletroposto|wallbox|recarga)\\b'), 'carro_eletrico'],
];
/**
 * Verbo de morar é SINAL, não categoria: sozinho não preenche
 * ('moro aqui' não diz o que é o lugar), mas conta pra abstenção. Sem isto,
 * 'tenho uma loja e moro em cima' virava comércio — a abstenção só lia
 * substantivo, e 'moro' é verbo. Achado da varredura de 12/09.
 *
 * 'morador' desacompanhado entra AQUI, não em PERFIL_PALAVRAS: mesmo peso do
 * verbo (varredura 5) — senão 'sou morador e tenho uma loja' vira comércio
 * enquanto 'moro aqui e tenho uma loja' abstém.
 */
const PERFIL_MORAR = rx('\\b(mor(o|amos|ando|ava|ei)|resid(o|imos)|morador(es|a|as)?)\\b');

export function perfilNaFrase(texto: string): string | null {
  let resto = texto;
  const categorias = new Set<string>();
  for (const [re, cat] of PERFIL_FRASES) {
    if (re.test(resto)) {
      categorias.add(cat);
      // mascara pra o 'casa' de 'casa de bolos' não contar como residência
      resto = resto.replace(new RegExp(re.source, 'gi'), ' ');
    }
  }
  for (const [re, cat] of PERFIL_PALAVRAS) if (re.test(resto)) categorias.add(cat);
  if (categorias.has(AMBIGUO)) return null;
  // 'morar' só CONFLITA com comércio. Com condomínio e carro elétrico é
  // compatível — 'moro num condomínio' É o jeito de quem mora em condomínio
  // se descrever, e a 1ª versão desta regra abstinha aí (varredura 2, 12/09).
  if (PERFIL_MORAR.test(resto) && categorias.has('comercio')) return null;
  // Duas categorias = ambiguidade real. A rede não desempata.
  if (categorias.size !== 1) return null;
  return [...categorias][0];
}
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

  if (falta('perfil_cliente')) {
    const perfil = perfilNaFrase(texto);
    if (perfil) {
      const lista = aceitos('perfil_cliente');
      // Enum do nó manda. Se o fluxo não declara o valor, a rede não o inventa —
      // o roteador compara texto literal e um valor fora da lista cai no default.
      if (!lista || lista.includes(perfil)) out.perfil_cliente = perfil;
    }
  }

  return out;
}
