import { describe, expect, it } from 'vitest';
import {
  conviteDaPergunta,
  correnteNaFrase,
  extrairDeterministico,
  perfilNaFrase,
  tensaoNaFrase,
} from './extracao-deterministica';
import { parseVariaveisGravadas } from './variaveis-gravadas.util';

/**
 * As falas são transcrições REAIS das conversas de 09-11/09 registradas nos
 * cards — não exemplos inventados. O defeito que isto fecha foi visto assim:
 *
 *   04:52:47  CLIENTE → "queimou o freezer da minha padaria. o disjuntor geral
 *                        aqui e de 63A e a tensao e 220V"
 *   04:53:03  BOT     → "E qual o padrão de energia aí, 110V, 220V ou 380V?"
 *   04:53:21  CLIENTE → "e 220V mesmo, ja tinha falado"
 */
const C1 = parseVariaveisGravadas([
  'corrente_quadro',
  'tensao_rede: 127V | 220V | 380V | 440V | nao sei',
  'perfil_cliente: comercio | residencia | condominio | carro_eletrico',
  'o_que_proteger',
  'origem_corrente: disjuntor | conta | estimativa',
]);

describe('tensaoNaFrase', () => {
  it.each([
    [
      'queimou o freezer da minha padaria. o disjuntor geral aqui e de 63A e a tensao e 220V',
      '220',
    ],
    ['e 220V mesmo, ja tinha falado', '220'],
    ['a rede aqui e 380 trifasico', '380'],
    ['é 220 v', '220'],
    ['aqui é 127 volts', '127'],
    ['o padrão é 380', '380'],
  ])('acha em %j', (frase, esperado) => {
    expect(tensaoNaFrase(frase)?.valor).toBe(esperado);
  });

  /**
   * ⚠️ O custo de errar não é simétrico: campo vazio faz o bot perguntar de
   * novo; campo errado manda o cliente pro produto errado. Por isso número
   * solto NUNCA vira tensão.
   */
  it.each([
    ['meu freezer tem 220 litros', 'unidade errada'],
    ['o disjuntor geral aqui e de 63A', 'corrente, não tensão'],
    ['custou 380 reais', 'dinheiro'],
    ['tenho 127 metros de cabo', 'metro'],
    ['sao 220 clientes por dia', 'número solto, sem pista'],
    ['nao sei qual é', 'sem número'],
    ['', 'vazio'],
  ])('NÃO inventa em %j (%s)', (frase) => {
    expect(tensaoNaFrase(frase)).toBeNull();
  });
});

describe('correnteNaFrase', () => {
  it.each([
    ['o disjuntor geral aqui e de 63A', '63'],
    ['63 A', '63'],
    ['é de 50 amperes', '50'],
    ['o disjuntor maior é 100', '100'],
    ['no quadro aparece 40', '40'],
  ])('acha em %j', (frase, esperado) => {
    expect(correnteNaFrase(frase)?.valor).toBe(esperado);
  });

  it.each([
    ['a tensao e 220V', 'tensão veta'],
    ['tenho 63 anos', 'idade'],
    ['sao 2 quadros', 'abaixo do mínimo plausível'],
    ['a rede aqui e 380 trifasico', 'pista de tensão, não de corrente'],
  ])('NÃO inventa em %j (%s)', (frase) => {
    expect(correnteNaFrase(frase)).toBeNull();
  });
});

describe('extrairDeterministico — o caso que abriu o card', () => {
  const FALA =
    'queimou o freezer da minha padaria. o disjuntor geral aqui e de 63A e a tensao e 220V';

  /**
   * Os TRÊS que o modelo perdeu em 11/09 (0/5). "padaria" é o perfil — era o
   * campo que sobrava depois da rede de tensão+corrente.
   */
  it('a frase completa entrega os três campos que os portões leem', () => {
    expect(extrairDeterministico(C1, FALA, {})).toEqual({
      corrente_quadro: '63',
      tensao_rede: '220V',
      perfil_cliente: 'comercio',
    });
  });

  /** É rede, não substituto: o que o modelo trouxe manda. */
  it('NÃO sobrescreve o que o modelo já extraiu', () => {
    const r = extrairDeterministico(C1, FALA, { tensao_rede: '380V' });
    expect(r.tensao_rede).toBeUndefined();
    expect(r.corrente_quadro).toBe('63');
  });

  it('valor presente porém VAZIO conta como lacuna', () => {
    expect(extrairDeterministico(C1, FALA, { tensao_rede: '  ' }).tensao_rede).toBe('220V');
  });

  it('campo que o nó não declarou nunca é gravado', () => {
    const soCorrente = parseVariaveisGravadas(['corrente_quadro']);
    expect(extrairDeterministico(soCorrente, FALA, {})).toEqual({ corrente_quadro: '63' });
  });
});

/**
 * 🔴 O "110V" é falha GARANTIDA, não probabilística: o TEXTO FIXO do fluxo
 * pergunta *"110V, 220V ou 380V?"* e o enum do nó é
 * `127V | 220V | 380V | 440V | nao sei`. Quem responde exatamente o que o bot
 * ofereceu não tem valor possível — e é perguntado de novo, toda vez.
 *
 * No Brasil "110" é como se chama a rede de 127V (mesma tomada), então o mapa
 * não é chute: é o nome popular do valor que o enum já aceita.
 */
describe('110V — o que o próprio bot oferece e o enum não aceita', () => {
  it('"110" vira 127V quando o nó aceita 127V e não aceita 110V', () => {
    expect(extrairDeterministico(C1, 'aqui é 110V', {}).tensao_rede).toBe('127V');
  });

  it('se o nó declarar 110V, o declarado MANDA (sem mapa)', () => {
    const com110 = parseVariaveisGravadas(['tensao_rede: 110V | 220V']);
    expect(extrairDeterministico(com110, 'aqui é 110V', {}).tensao_rede).toBe('110V');
  });

  it('não grava valor fora do enum do nó', () => {
    const so220 = parseVariaveisGravadas(['tensao_rede: 220V']);
    expect(extrairDeterministico(so220, 'aqui é 380V', {}).tensao_rede).toBeUndefined();
  });
});

/**
 * 🔴 A HESITAÇÃO — medido em produção 11/09 15:02, e não é caso de borda.
 *
 * ```
 * cliente → "acho que e 110 volts aqui, e o padrao antigo mesmo"
 *           tensao_rede = "nao sei"      ← o modelo leu o "acho que"
 *           link saiu SEM tensão: "Como você não tem certeza, deixei esse
 *           campo pra escolher na página"
 * ```
 *
 * **A pessoa deu o número.** O modelo transformou insegurança em ausência de
 * informação — e a rede não corrigia, porque `nao sei` era tratado como VALOR
 * (logo, não era lacuna) em vez de ausência.
 *
 * ⚠️ Falar de elétrica hesitando é como gente não-técnica fala, e é exatamente
 * o público deste fluxo. Aqui a hesitação é o caso NORMAL.
 */
describe('hesitação — "nao sei" é lacuna, não valor', () => {
  it('resgata o número que a pessoa deu apesar do "acho que"', () => {
    const r = extrairDeterministico(C1, 'acho que e 110 volts aqui, e o padrao antigo mesmo', {
      tensao_rede: 'nao sei',
    });
    expect(r.tensao_rede).toBe('127V');
  });

  it.each([['nao sei, deve ser 127 volts'], ['acho que e 220v'], ['a rede aqui deve ser 380']])(
    'também em %j',
    (frase) => {
      expect(extrairDeterministico(C1, frase, { tensao_rede: 'nao sei' }).tensao_rede).toBeTruthy();
    },
  );

  /**
   * ⛔ LIMITE CONHECIDO, e é escolha, não esquecimento.
   *
   * "deve ser 220 mesmo" não tem unidade colada nem pista de tensão perto —
   * é um número solto. Aceitar número solto faria "sao 220 clientes por dia"
   * virar 220V, e o custo dos dois erros não é igual: campo vazio faz o bot
   * perguntar; campo errado manda o cliente pro produto que não protege a
   * instalação dele.
   *
   * 📌 O que fecharia isto com segurança é o CONTEXTO DA PERGUNTA: se o bot
   * acabou de perguntar a tensão, um número solto na resposta é a tensão.
   * Hoje a rede não recebe a última fala do bot — enquanto não receber, este
   * caso fica com o modelo.
   */
  it.each([['deve ser 220 mesmo'], ['acho que é 380']])(
    'NÃO cobre número solto sem unidade nem pista: %j',
    (frase) => {
      expect(
        extrairDeterministico(C1, frase, { tensao_rede: 'nao sei' }).tensao_rede,
      ).toBeUndefined();
    },
  );

  /** Quem realmente não sabe continua não sabendo — a rede não inventa. */
  it('sem número na frase, "nao sei" continua "nao sei"', () => {
    const r = extrairDeterministico(C1, 'sinceramente nao faco ideia', {
      tensao_rede: 'nao sei',
    });
    expect(r.tensao_rede).toBeUndefined();
  });

  /** Presença vence: valor concreto do modelo não é tocado. */
  it('valor concreto do modelo NÃO é sobrescrito por número na frase', () => {
    const r = extrairDeterministico(C1, 'acho que e 110 volts', { tensao_rede: '220V' });
    expect(r.tensao_rede).toBeUndefined();
  });

  it('as outras formas de ausência valem igual', () => {
    for (const ausente of ['n/a', 'indefinido', '-', '?', 'nao informado']) {
      expect(extrairDeterministico(C1, 'aqui e 220v', { tensao_rede: ausente }).tensao_rede).toBe(
        '220V',
      );
    }
  });
});

/**
 * ⭐ O CONTEXTO DA PERGUNTA — é ele que torna seguro aceitar número solto.
 *
 * Medido em 11/09 15:08:
 * ```
 * BOT     → "E qual o padrão de energia aí, 110V, 220V ou 380V?"
 * cliente → "220"
 * ```
 *
 * **A copy convida ao número solto.** Ele não é caso raro — é o caso que a
 * pergunta produz. O mesmo no outro portão: o texto pede *"um número seguido da
 * letra A"* e vem **"63"**.
 *
 * E a objeção que impedia aceitar número solto (`"sao 220 clientes por dia"`
 * virar 220V) **desaparece sob o contexto**: essa frase nunca é resposta a
 * *"qual o padrão de energia?"*.
 */
const PERGUNTA_TENSAO = 'E qual o padrão de energia aí, 110V, 220V ou 380V?';
const PERGUNTA_CORRENTE =
  'Consegue olhar no quadro de luz o disjuntor maior? Nele aparece um número seguido da letra A, como 40A, 63A';

describe('conviteDaPergunta', () => {
  it('reconhece os dois TEXTOS FIXOS reais do C1', () => {
    expect(conviteDaPergunta(PERGUNTA_TENSAO)).toBe('tensao');
    expect(conviteDaPergunta(PERGUNTA_CORRENTE)).toBe('corrente');
  });

  it('pergunta que não é de nenhum dos dois não convida nada', () => {
    expect(conviteDaPergunta('Tudo certo por aí? Posso ajudar em mais alguma coisa?')).toBeNull();
    expect(conviteDaPergunta(undefined)).toBeNull();
  });

  /** Ambiguidade volta pro caminho conservador — número solto ali não decide. */
  it('pergunta que puxa os DOIS não convida número solto', () => {
    expect(conviteDaPergunta('Me diz a tensão e a corrente do disjuntor')).toBeNull();
  });
});

describe('número solto — só com o convite da pergunta', () => {
  it('"220" depois da pergunta da tensão vira 220V', () => {
    const r = extrairDeterministico(C1, '220', {}, conviteDaPergunta(PERGUNTA_TENSAO));
    expect(r.tensao_rede).toBe('220V');
  });

  it('"63" depois da pergunta da corrente vira 63A', () => {
    const r = extrairDeterministico(C1, '63', {}, conviteDaPergunta(PERGUNTA_CORRENTE));
    expect(r.corrente_quadro).toBe('63');
  });

  it('"deve ser 220 mesmo" passa a valer quando o bot acabou de perguntar', () => {
    const r = extrairDeterministico(
      C1,
      'deve ser 220 mesmo',
      { tensao_rede: 'nao sei' },
      conviteDaPergunta(PERGUNTA_TENSAO),
    );
    expect(r.tensao_rede).toBe('220V');
  });

  /** ⛔ Sem convite, número solto continua fora — a regra antiga não afrouxou. */
  it('SEM convite, número solto continua recusado', () => {
    expect(extrairDeterministico(C1, 'deve ser 220 mesmo', {}).tensao_rede).toBeUndefined();
    expect(extrairDeterministico(C1, '220', {}).tensao_rede).toBeUndefined();
  });

  /**
   * ⚠️ O convite abre o número solto, mas NÃO desliga as armadilhas de unidade:
   * mesmo respondendo à pergunta da tensão, "220 litros" não é tensão.
   */
  it('o convite não desliga a checagem de unidade errada', () => {
    const r = extrairDeterministico(
      C1,
      'tenho um freezer de 220 litros',
      {},
      conviteDaPergunta(PERGUNTA_TENSAO),
    );
    expect(r.tensao_rede).toBeUndefined();
  });

  it('convite de tensão não faz número virar corrente', () => {
    const r = extrairDeterministico(C1, '220', {}, conviteDaPergunta(PERGUNTA_TENSAO));
    expect(r.corrente_quadro).toBeUndefined();
  });
});

/**
 * 🔴 O teste que FALTOU — e a ausência dele deixou um bug passar pro ar.
 *
 * A regex de pergunta-de-corrente tem 5 alternativas. A frase que eu usei no
 * teste original (`PERGUNTA_CORRENTE`) casa por **três** delas ao mesmo tempo
 * ("quadro de luz", "disjuntor", "letra a"). Então quando a alternativa
 * `letra a\b` nasceu com um byte de BACKSPACE no lugar da borda de palavra, o
 * teste continuou VERDE — as outras duas seguravam.
 *
 * ⚠️ Teste que exercita várias alternativas de uma vez não testa nenhuma: ele
 * prova só que ALGUMA casou. Quem quebra uma sozinha não é visto.
 *
 * O defeito só apareceu rodando a rota de diagnóstico contra produção, com um
 * TRECHO da pergunta — o pedaço que só tem "letra A".
 */
describe('cada alternativa da pergunta, ISOLADA', () => {
  it.each([
    ['letra a (a que estava quebrada)', 'Nele aparece um número seguido da letra A, como 40A, 63A'],
    ['disjuntor', 'Dá uma olhada no disjuntor geral e me diz o número'],
    ['quadro de luz', 'Consegue abrir o quadro de luz?'],
    ['corrente', 'Qual a corrente que aparece ali?'],
    ['amperes', 'Quantos amperes marca?'],
  ])('reconhece corrente só por %s', (_rotulo, frase) => {
    expect(conviteDaPergunta(frase)).toBe('corrente');
  });

  it.each([
    ['tensão', 'Qual a tensão da rede aí?'],
    ['padrão de energia', 'E qual o padrão de energia aí?'],
    ['volts', 'É quantos volts?'],
    ['220V no texto', 'É 220V ou 380V?'],
  ])('reconhece tensão só por %s', (_rotulo, frase) => {
    expect(conviteDaPergunta(frase)).toBe('tensao');
  });

  /** A regressão exata que a produção mostrou: o trecho isolado da pergunta. */
  it('o TRECHO da pergunta da corrente convida número solto', () => {
    const trecho = 'Nele aparece um número seguido da letra A, como 40A, 63A. Qual aparece?';
    expect(conviteDaPergunta(trecho)).toBe('corrente');
    expect(extrairDeterministico(C1, '63', {}, conviteDaPergunta(trecho)).corrente_quadro).toBe(
      '63',
    );
  });
});

/**
 * 🔴 OS FALSOS POSITIVOS que a varredura de 24 redações achou (11/09).
 *
 * O convite da pergunta libera número solto — e liberava DEMAIS: qualquer 220
 * virava 220V, mesmo quando a frase dizia outra coisa. A checagem de unidade não
 * pega, porque ela veta "litros" e "metros", e "clientes" não é unidade.
 *
 * ⚠️ São frases implausíveis como resposta a "qual o padrão de energia?", e essa
 * era a única proteção. **Implausível não é impossível**, e o dano é assimétrico:
 * gravar 220V errado manda a pessoa pra uma calculadora dimensionada na tensão
 * errada, sem ela ter como saber. É pior que perguntar de novo.
 */
describe('número solto: o que vem DEPOIS pode desmentir', () => {
  const PERGUNTA = 'E qual o padrão de energia aí, 110V, 220V ou 380V?';
  const convite = () => conviteDaPergunta(PERGUNTA);

  it.each([
    ['sao 220 clientes por dia'],
    ['moro no 220 da rua'],
    ['sao 220 reais por mes'],
    ['tem 380 funcionarios'],
  ])('NÃO grava quando o número é outra coisa: %j', (frase) => {
    expect(extrairDeterministico(C1, frase, {}, convite()).tensao_rede).toBeUndefined();
  });

  it.each([
    ['220', '220V'],
    ['é 220', '220V'],
    ['deve ser 220 mesmo', '220V'],
    ['acho que e 220', '220V'],
    ['380 trifasica', '380V'],
    ['220.', '220V'],
    ['é 127 sim', '127V'],
  ])('continua gravando a resposta de verdade: %j', (frase, esperado) => {
    expect(extrairDeterministico(C1, frase, {}, convite()).tensao_rede).toBe(esperado);
  });
});

/**
 * 🟠 O formato do `corrente_quadro` — duas fontes, um campo.
 *
 * O prompt do C1-L declara o contrato: *"`corrente` — só o número, em ampères.
 * `63`, não `63A`"*. A rede gravava `"63A"`, o modelo grava `"63"`.
 *
 * ⚠️ Mesma família dos contratos desalinhados de `tensao_rede`: o nó que monta o
 * link leria `63A` e poderia mandar `corrente=63A`, que a calculadora não
 * parseia — e só no caminho RARO em que a rede dispara, que é o que ninguém vê.
 */
describe('corrente_quadro sai no formato do contrato', () => {
  const PERGUNTA_A = 'Nele aparece um número seguido da letra A, como 40A, 63A';

  it.each([
    ['o disjuntor geral aqui e de 63A', '63'],
    ['63 A', '63'],
    ['é de 50 amperes', '50'],
  ])('%j → %s (sem o "A")', (frase, esperado) => {
    expect(extrairDeterministico(C1, frase, {}).corrente_quadro).toBe(esperado);
  });

  it('número solto após a pergunta também sai sem o "A"', () => {
    expect(extrairDeterministico(C1, '63', {}, conviteDaPergunta(PERGUNTA_A)).corrente_quadro).toBe(
      '63',
    );
  });

  it('"tem um de 60 ali" ainda vale — "ali" não desmente o número', () => {
    expect(
      extrairDeterministico(C1, 'tem um de 60 ali', {}, conviteDaPergunta(PERGUNTA_A))
        .corrente_quadro,
    ).toBe('60');
  });
});

/**
 * 🔴 INCERTEZA EXPLÍCITA — a rede não decide no lugar da pessoa.
 *
 * Achado na varredura de 19 frases (11/09), e é a classe mais grave das três:
 *
 * ```
 * "110 ou 220, nao sei bem"   → gravava 127V   🔴
 * "220/380"                    → gravava 220V   🔴
 * "tem 220 e 380 aqui"         → gravava 220V   🔴
 * ```
 *
 * ⚠️ A pessoa está **literalmente dizendo que não sabe**, e o resultado era uma
 * calculadora dimensionada num chute — sem ninguém ficar sabendo que foi chute.
 * É pior que não gravar: o caminho honesto (`nao sei` ou vazio) já é tratado, e
 * abre a página com a tensão em aberto pra ela escolher.
 *
 * 📌 `"tem 220 e 380 aqui"` não é frase adversarial inventada: quadro de comércio
 * com dois padrões é caso real.
 */
describe('duas tensões na frase: a rede se cala', () => {
  const PERGUNTA = 'E qual o padrão de energia aí, 110V, 220V ou 380V?';

  it.each([
    ['110 ou 220, nao sei bem'],
    ['220/380'],
    ['tem 220 e 380 aqui'],
    ['pode ser 127 ou 220'],
  ])('NÃO escolhe em %j', (frase) => {
    expect(
      extrairDeterministico(C1, frase, {}, conviteDaPergunta(PERGUNTA)).tensao_rede,
    ).toBeUndefined();
  });

  /** Mesmo valor repetido não é ambiguidade — é ênfase. */
  it('"220V mesmo, 220 confirmado" continua valendo', () => {
    expect(extrairDeterministico(C1, 'é 220V mesmo, 220 confirmado', {}).tensao_rede).toBe('220V');
  });

  it('duas correntes diferentes também calam a rede', () => {
    expect(
      extrairDeterministico(C1, 'tem um de 63A e outro de 40A', {}).corrente_quadro,
    ).toBeUndefined();
  });
});

/**
 * ⛔ O CUSTO ACEITO da regra "a mensagem inteira é a resposta".
 *
 * Frase legítima mas VERBOSA deixa de ser capturada pela rede. É trade deliberado:
 * ali o MODELO responde (que é o caminho normal e acerta na maioria), e o custo
 * de errar não é simétrico — perder uma captura é perguntar de novo; gravar
 * errado é dimensionar errado sem ninguém saber.
 */
describe('limite conhecido: resposta verbosa cai pro modelo', () => {
  const PERGUNTA = 'E qual o padrão de energia aí, 110V, 220V ou 380V?';

  it.each([['aqui e 220 mesmo, predio novo'], ['e 220 aqui em casa da minha mae']])(
    'não captura %j (sujeito próprio na frase)',
    (frase) => {
      expect(
        extrairDeterministico(C1, frase, {}, conviteDaPergunta(PERGUNTA)).tensao_rede,
      ).toBeUndefined();
    },
  );

  /** Mas com a UNIDADE colada continua valendo, por mais verbosa que seja. */
  it('com "V" colado, a verbosidade não atrapalha', () => {
    expect(
      extrairDeterministico(C1, 'aqui e 220V mesmo, predio novo da esquina', {}).tensao_rede,
    ).toBe('220V');
  });
});

/**
 * 🔴 TIPO DE LOCAL (`perfil_cliente`) — o campo de maior custo de erro da rede.
 *
 * Ele decide a PÁGINA do link. Errar a tensão, a pessoa ainda vê o número na
 * tela; errar o local, ela cai em "proteção residencial" com uma padaria e não
 * tem como saber que existe outra página.
 *
 * Autorizado pelo Léo em 12/09 depois da rede ter salvado tensão e corrente numa
 * conversa real (modelo 0/5) — e a pessoa ter passado pelo consultivo SÓ por
 * causa deste campo. Vocabulário = tabela do prompt do C1-L.
 */
describe('perfilNaFrase — o tipo de local por regra, com a régua mais dura', () => {
  it.each([
    ['queimou o freezer da minha padaria', 'comercio'],
    ['tenho uma loja de conveniencia', 'comercio'],
    ['no restaurante queimou a camara fria', 'comercio'],
    ['é na minha casa', 'residencia'],
    ['moro em apartamento', 'residencia'],
    ['sou sindico do condominio', 'condominio'],
    ['o carregador do carro eletrico queimou', 'carro_eletrico'],
    ['instalei um wallbox', 'carro_eletrico'],
  ])('%j → %s', (frase, esperado) => {
    expect(perfilNaFrase(frase)).toBe(esperado);
  });

  /**
   * ⚠️ "casa de bolos" É comércio — e contém "casa". Sem resolver o composto
   * antes, a rede mandaria uma confeitaria pra página residencial.
   */
  it.each([['tenho uma casa de bolos'], ['minha casa de carnes'], ['é uma casa noturna']])(
    'composto de comércio com "casa" → comercio: %j',
    (frase) => {
      expect(perfilNaFrase(frase)).toBe('comercio');
    },
  );

  /** DUAS categorias = a rede se cala. Quem desempata é o modelo. */
  it.each([
    ['a padaria do meu condominio'],
    ['carregador do carro na minha casa'],
    ['tenho loja e moro em cima, na casa'],
  ])('ambíguo NÃO decide: %j', (frase) => {
    expect(perfilNaFrase(frase)).toBeNull();
  });

  it.each([['queimou o freezer'], ['e 220v aqui'], ['nao sei o que e']])(
    'sem palavra de local → nada: %j',
    (frase) => {
      expect(perfilNaFrase(frase)).toBeNull();
    },
  );

  /** Só palavra inteira — "casal" ≠ casa, "barco" ≠ bar. */
  it('não casa por substring', () => {
    expect(perfilNaFrase('somos um casal')).toBeNull();
    expect(perfilNaFrase('meu barco')).toBeNull();
  });
});

describe('extrairDeterministico — perfil_cliente entra na rede', () => {
  it('preenche o tipo de local quando o modelo não trouxe', () => {
    const r = extrairDeterministico(C1, 'queimou o freezer da minha padaria, 63A e 220V', {});
    expect(r.perfil_cliente).toBe('comercio');
    expect(r.tensao_rede).toBe('220V');
    expect(r.corrente_quadro).toBe('63');
  });

  it('NÃO sobrescreve o que o modelo trouxe', () => {
    const r = extrairDeterministico(C1, 'minha padaria', { perfil_cliente: 'condominio' });
    expect(r.perfil_cliente).toBeUndefined();
  });

  it('"nao sei" é lacuna também aqui', () => {
    const r = extrairDeterministico(C1, 'é aqui em casa', { perfil_cliente: 'nao sei' });
    expect(r.perfil_cliente).toBe('residencia');
  });

  it('respeita o enum do nó — valor não declarado não é gravado', () => {
    const so2 = parseVariaveisGravadas(['perfil_cliente: comercio | residencia']);
    expect(
      extrairDeterministico(so2, 'sou sindico do condominio', {}).perfil_cliente,
    ).toBeUndefined();
  });

  it('nó que não declara perfil_cliente nunca o recebe', () => {
    const semPerfil = parseVariaveisGravadas(['tensao_rede: 127V | 220V']);
    expect(extrairDeterministico(semPerfil, 'minha padaria', {}).perfil_cliente).toBeUndefined();
  });
});

/**
 * Varredura da Testadora em 12/09 sobre o 75469dc: 7 falsos positivos em 3
 * classes. Duas têm remédio de regra e estão aqui; a terceira (local de OUTRO,
 * passado, futuro, menção incidental — "a loja do meu vizinho", "tinha uma
 * loja", "passei na loja") não tem, e fica como limite conhecido.
 */
describe('perfilNaFrase — o que a varredura de 12/09 pegou', () => {
  describe('classe 1: verbo de morar conta pra abstenção', () => {
    it.each(['tenho uma loja e moro em cima', 'moro na rua do mercado', 'moro em cima da padaria'])(
      '"%s" → null',
      (f) => expect(perfilNaFrase(f)).toBeNull(),
    );

    it('sozinho NÃO preenche: "moro aqui" → null', () => {
      expect(perfilNaFrase('moro aqui e queimou tudo')).toBeNull();
    });

    /**
     * Varredura 2 (12/09): a 1ª versão abstinha em 'moro num condomínio' —
     * silenciava o caso VERDADEIRO enquanto 'minha sogra mora num condomínio'
     * (3ª pessoa, classe 2) passava. Morar só conflita com comércio.
     */
    it.each([
      ['moro num condominio', 'condominio'],
      ['moro num predio com sindico', 'condominio'],
      ['moro e o carregador fica na garagem', 'carro_eletrico'],
    ])('compatível, não conflito: "%s" → %s', (f, esperado) => {
      expect(perfilNaFrase(f)).toBe(esperado);
    });

    it('com substantivo de residência continua preenchendo', () => {
      expect(perfilNaFrase('moro em apartamento')).toBe('residencia');
      expect(perfilNaFrase('moro numa casa')).toBe('residencia');
    });
  });

  describe('classe 3: "casa de X" desconhecido abstém, em vez de virar residência', () => {
    it.each(['queimou o quadro da casa de maquinas', 'e a casa da minha mae', 'casa do vizinho'])(
      '"%s" → null',
      (f) => expect(perfilNaFrase(f)).toBeNull(),
    );

    it('os compostos conhecidos continuam resolvendo', () => {
      expect(perfilNaFrase('casa de praia')).toBe('residencia');
      expect(perfilNaFrase('casa de racao')).toBe('comercio');
      expect(perfilNaFrase('casa de shows')).toBe('comercio');
    });
  });

  /** Varredura 3: 'sou síndico do prédio' classificava e 'sou morador' não — e morador é todo o resto do prédio. */
  it('vocabulário: "sou morador do predio" → condominio', () => {
    expect(perfilNaFrase('sou morador do predio')).toBe('condominio');
    expect(perfilNaFrase('os moradores reclamaram')).toBe('condominio');
  });

  /** Escolha registrada (12/09): residência + carro elétrico juntos ABSTÉM. Decidir qual página ganha é produto, não regra. */
  it('"moro em apartamento e instalei carregador" → null (duas categorias reais)', () => {
    expect(perfilNaFrase('moro em apartamento e instalei carregador')).toBeNull();
  });

  it('vocabulário: "no meu consultorio" → comercio', () => {
    expect(perfilNaFrase('no meu consultorio')).toBe('comercio');
  });
});
