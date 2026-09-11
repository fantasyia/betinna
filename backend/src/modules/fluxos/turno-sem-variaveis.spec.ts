import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConversarIaService } from './conversar-ia.service';
import { parseVariaveisGravadas, type VariavelGravavel } from './variaveis-gravadas.util';

/**
 * O turno que declara variáveis e volta com NENHUMA precisa deixar rastro.
 *
 * Medido em 11/09, 1 vez em 5 rodadas: o modelo devolveu `variaveis: {}` — nem
 * os campos com enum, nem os livres. O portão seguinte leu vazio e mandou o
 * TEXTO FIXO perguntando a tensão que a pessoa tinha acabado de dizer. Do lado
 * do cliente, indistinguível do defeito original.
 *
 * ⚠️ O perigo não é a frequência, é a INVISIBILIDADE: passo VERDE, sem erro,
 * sem log. O único rastro era o `{}` — que também é o estado legítimo de um
 * turno sem novidade. Ninguém separava "não extraiu" de "não era pra extrair".
 *
 * Isto não conserta a extração. Torna o caso CONTÁVEL, que é o que permite
 * decidir entre conviver e consertar.
 */
const chamar = (
  svc: ConversarIaService,
  p: {
    gravaveis: string[];
    variaveisTurno: Record<string, unknown>;
    /** O que ESTE turno leu no começo — pode estar velho. */
    leadVariaveis?: Record<string, unknown>;
    /** Estado REAL da linha, quando outro escritor mexeu nela no meio. */
    noBanco?: Record<string, unknown>;
    declaradas?: VariavelGravavel[];
    texto?: string;
  },
) => {
  // Banco de mentira com a única semântica que importa aqui: o UPDATE faz
  // MERGE do patch sobre o valor CORRENTE da linha — nunca sobre o objeto que
  // o turno leu lá atrás. Era exatamente essa diferença que apagava dado.
  const estado: Record<string, unknown> = { ...(p.noBanco ?? p.leadVariaveis ?? {}) };
  Object.defineProperty(svc, 'prisma', {
    value: {
      $queryRaw: (_s: TemplateStringsArray, ...vals: unknown[]) => {
        const patch = JSON.parse(String(vals[0])) as Record<string, unknown>;
        Object.assign(estado, patch);
        return Promise.resolve([{ variaveis: { ...estado } }]);
      },
    },
    writable: true,
    configurable: true,
  });
  return (
    svc as unknown as {
      gravarVariaveisDoTurno: (a: {
        leadId: string;
        leadVariaveis: unknown;
        gravaveis: string[];
        variaveisTurno: Record<string, unknown>;
        declaradas?: VariavelGravavel[];
        texto?: string;
        execucaoId: string;
      }) => Promise<Record<string, unknown>>;
    }
  ).gravarVariaveisDoTurno({
    leadId: 'lead-1',
    leadVariaveis: p.leadVariaveis ?? {},
    gravaveis: p.gravaveis,
    variaveisTurno: p.variaveisTurno,
    declaradas: p.declaradas,
    texto: p.texto,
    execucaoId: 'exec-1',
  });
};

const DECLARADAS = ['tensao_rede', 'corrente_quadro', 'perfil_cliente'];

describe('turno que declara variáveis e grava ZERO', () => {
  let svc: ConversarIaService;
  let avisos: string[];

  beforeEach(() => {
    svc = Object.create(ConversarIaService.prototype) as ConversarIaService;
    avisos = [];
    Object.defineProperty(svc, 'logger', {
      value: { warn: (m: string) => avisos.push(m), log: vi.fn(), error: vi.fn() },
      writable: true,
    });
  });

  it('avisa quando declarou e não gravou nada', async () => {
    await chamar(svc, { gravaveis: DECLARADAS, variaveisTurno: {} });
    expect(avisos.join(' ')).toContain('declarou 3 variáveis e gravou 0');
  });

  /**
   * O DISCRIMINADOR. Turno vazio com o lead já completo é o caso normal — não
   * havia novidade. O suspeito é vazio com o lead sem nada: primeira passagem,
   * que é exatamente onde a extração é a razão de o nó existir.
   */
  it('marca a PRIMEIRA passagem, que é o caso suspeito', async () => {
    await chamar(svc, { gravaveis: DECLARADAS, variaveisTurno: {} });
    expect(avisos.join(' ')).toContain('PRIMEIRA passagem');
    expect(avisos.join(' ')).toContain('já tinha 0/3');
  });

  it('NÃO marca como primeira passagem quando o lead já tem os campos', async () => {
    await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: {},
      leadVariaveis: { tensao_rede: '220V', corrente_quadro: '63', perfil_cliente: 'comercio' },
    });
    expect(avisos.join(' ')).toContain('já tinha 3/3');
    expect(avisos.join(' ')).not.toContain('PRIMEIRA passagem');
  });

  it('não avisa quando gravou alguma coisa', async () => {
    await chamar(svc, { gravaveis: DECLARADAS, variaveisTurno: { tensao_rede: '220V' } });
    expect(avisos.join(' ')).not.toContain('gravou 0');
  });

  /**
   * Nó SEM `variaveisGravadas` não tem o que extrair — avisar ali seria ruído
   * em todo turno de todo fluxo que não usa a função.
   */
  it('nó que não declara variáveis nunca aparece no log', async () => {
    await chamar(svc, { gravaveis: [], variaveisTurno: {} });
    expect(avisos).toHaveLength(0);
  });

  /**
   * O schema costuma voltar com as chaves presentes e vazias. Isso conta como
   * "gravou 0" — é o mesmo efeito prático pro portão seguinte.
   */
  it('chaves presentes porém VAZIAS contam como zero', async () => {
    await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: { tensao_rede: '', corrente_quadro: null, perfil_cliente: '   ' },
    });
    expect(avisos.join(' ')).toContain('gravou 0');
  });
});

/**
 * 🔴 A extração falha PARCIAL com muito mais frequência que total — medido no
 * log de produção em 11/09: vem a corrente e não vem a tensão.
 *
 * E o portão do C1 não pergunta "veio alguma coisa?", pergunta
 * `custom.tensao_rede`. **Um campo faltando é o defeito inteiro** — mas a linha
 * de "gravou 0" só pega o tudo-ou-nada, então esse caso era invisível.
 *
 * É exatamente o ponto cego que a sessão de teste levantou e que eu tinha
 * documentado sem instrumentar.
 */
describe('extração PARCIAL — o que o portão vai ler vazio', () => {
  let svc: ConversarIaService;
  let avisos: string[];

  beforeEach(() => {
    svc = Object.create(ConversarIaService.prototype) as ConversarIaService;
    avisos = [];
    Object.defineProperty(svc, 'logger', {
      value: { warn: (m: string) => avisos.push(m), log: vi.fn(), error: vi.fn() },
      writable: true,
    });
  });

  it('avisa QUAIS campos ficaram faltando quando gravou só uma parte', async () => {
    await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: { corrente_quadro: '63' },
    });
    const txt = avisos.join(' ');
    expect(txt).toContain('extração PARCIAL');
    expect(txt).toContain('faltam 2/3');
    expect(txt).toContain('tensao_rede');
    expect(txt).toContain('perfil_cliente');
  });

  /** Campo que o lead já tinha de um turno anterior não é perda. */
  it('não conta como falta o que o lead JÁ tinha', async () => {
    await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: { corrente_quadro: '63' },
      leadVariaveis: { tensao_rede: '220V', perfil_cliente: 'comercio' },
    });
    expect(avisos.join(' ')).not.toContain('extração PARCIAL');
  });

  it('turno completo não avisa nada', async () => {
    await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: { corrente_quadro: '63', tensao_rede: '220V', perfil_cliente: 'comercio' },
    });
    expect(avisos.join(' ')).not.toContain('extração PARCIAL');
  });

  /**
   * Zero e parcial são linhas DIFERENTES de propósito: zero é "o turno não
   * entregou nada", parcial é "entregou e faltou". Misturar as duas devolveria
   * o problema de não saber qual caso se está contando.
   */
  it('gravou ZERO não vira linha de PARCIAL (são contagens distintas)', async () => {
    await chamar(svc, { gravaveis: DECLARADAS, variaveisTurno: {} });
    const txt = avisos.join(' ');
    expect(txt).toContain('gravou 0');
    expect(txt).not.toContain('extração PARCIAL');
  });
});

/**
 * 🔴 ESCRITA CONCORRENTE — o defeito que se disfarça de "a IA não extraiu".
 *
 * `gravarVariaveisDoTurno` recebe o `Lead.variaveis` lido no COMEÇO do turno e,
 * até 11/09, reescrevia a coluna inteira a partir dele. Entre a leitura e a
 * escrita passam dezenas de segundos (a chamada ao modelo), e nesse intervalo
 * outro escritor no mesmo lead é rotina: janela de rajada, um segundo fluxo, ou
 * a re-execução do turno depois do SIGTERM (D51).
 *
 * O perdedor da corrida ressuscitava o estado velho. O campo que a pessoa acabou
 * de informar sumia, e o portão seguinte perguntava de novo — do lado do
 * cliente, IDÊNTICO à extração ter falhado.
 *
 * ⚠️ E é por isso que ele envenena a medição além de envenenar o dado: enquanto
 * existisse, nenhum lote conseguia separar "o modelo não extraiu" de "outro
 * escritor apagou". Foi assim que uma bancada inteira se contaminou em 11/09.
 */
describe('escrita concorrente no mesmo lead', () => {
  let svc: ConversarIaService;
  let avisos: string[];

  beforeEach(() => {
    svc = Object.create(ConversarIaService.prototype) as ConversarIaService;
    avisos = [];
    Object.defineProperty(svc, 'logger', {
      value: { warn: (m: string) => avisos.push(m), log: vi.fn(), error: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  it('NÃO apaga o que outro escritor gravou depois da leitura deste turno', async () => {
    const novas = await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: { corrente_quadro: '63' },
      leadVariaveis: {}, // o que ESTE turno leu: vazio
      noBanco: { tensao_rede: '220V' }, // outro turno gravou no meio
    });

    expect(novas.corrente_quadro).toBe('63');
    // Com o merge em memória, este valor era sobrescrito por `{}` e sumia.
    expect(novas.tensao_rede).toBe('220V');
  });

  /**
   * O instrumento de extração parcial só vale se ler o estado REAL da linha.
   * Medindo no objeto de memória, ele acusaria `tensao_rede` como perdida —
   * criando exatamente o falso positivo de "extração parcial" que mandaria a
   * investigação pro lado errado.
   */
  it('a contagem de PARCIAL lê o estado do BANCO, não o da memória', async () => {
    await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: { corrente_quadro: '63' },
      leadVariaveis: {},
      noBanco: { tensao_rede: '220V' },
    });

    const txt = avisos.join(' ');
    expect(txt).toContain('faltam 1/3');
    expect(txt).toContain('perfil_cliente');
    expect(txt).not.toContain('tensao_rede');
  });

  it('sem concorrência, o resultado é o de sempre', async () => {
    const novas = await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: { corrente_quadro: '63', tensao_rede: '220V', perfil_cliente: 'comercio' },
    });

    expect(novas).toMatchObject({
      corrente_quadro: '63',
      tensao_rede: '220V',
      perfil_cliente: 'comercio',
    });
    expect(avisos.join(' ')).not.toContain('PARCIAL');
  });
});

/**
 * 🔴 O caminho que NÃO passa pelo modelo — é isto que transforma "1 em 10" em
 * "o modelo errou e o cliente nem percebeu".
 *
 * Os testes de `extracao-deterministica.spec.ts` provam o PARSER. Estes provam a
 * LIGAÇÃO: turno que voltou `{}` e mesmo assim o lead sai com os campos que os
 * portões leem. Sem isto, a rede poderia estar perfeita e desconectada — e o
 * teste do parser continuaria verde.
 */
describe('rede determinística dentro da gravação', () => {
  let svc: ConversarIaService;
  let avisos: string[];

  const FALA = 'queimou o freezer da padaria. o disjuntor geral aqui e de 63A e a tensao e 220V';
  const DECL = parseVariaveisGravadas([
    'corrente_quadro',
    'tensao_rede: 127V | 220V | 380V | 440V | nao sei',
    'perfil_cliente: comercio | residencia | condominio | carro_eletrico',
  ]);

  beforeEach(() => {
    svc = Object.create(ConversarIaService.prototype) as ConversarIaService;
    avisos = [];
    Object.defineProperty(svc, 'logger', {
      value: { warn: (m: string) => avisos.push(m), log: vi.fn(), error: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  it('turno que voltou VAZIO ainda entrega tensão e corrente ao lead', async () => {
    const novas = await chamar(svc, {
      gravaveis: DECL.map((d) => d.nome),
      variaveisTurno: {}, // o modelo não trouxe NADA — o caso medido
      declaradas: DECL,
      texto: FALA,
    });

    expect(novas.tensao_rede).toBe('220V');
    expect(novas.corrente_quadro).toBe('63A');
    // E deixa rastro: cada linha destas é uma falha do modelo que a rede segurou.
    expect(avisos.join(' ')).toContain('rede determinística resgatou');
  });

  /**
   * ⚠️ O portão do C1 é `custom.tensao_rede contains "V"`. É esta asserção que
   * representa o cliente não ouvir de novo o que acabou de responder.
   */
  it('o valor resgatado SATISFAZ o portão do C1', async () => {
    const novas = await chamar(svc, {
      gravaveis: DECL.map((d) => d.nome),
      variaveisTurno: {},
      declaradas: DECL,
      texto: FALA,
    });
    expect(String(novas.tensao_rede)).toContain('V');
  });

  it('o que o modelo trouxe MANDA — a rede não sobrescreve', async () => {
    const novas = await chamar(svc, {
      gravaveis: DECL.map((d) => d.nome),
      variaveisTurno: { tensao_rede: '380V' },
      declaradas: DECL,
      texto: FALA, // a frase diz 220V
    });
    expect(novas.tensao_rede).toBe('380V');
  });

  /** Sem `declaradas`/`texto` nada muda — todo caminho antigo segue idêntico. */
  it('sem os campos novos, o comportamento é o de antes', async () => {
    await chamar(svc, { gravaveis: DECL.map((d) => d.nome), variaveisTurno: {} });
    expect(avisos.join(' ')).toContain('gravou 0');
    expect(avisos.join(' ')).not.toContain('rede determinística');
  });

  /** A rede não inventa: frase sem número não produz gravação nenhuma. */
  it('frase sem dado não vira gravação', async () => {
    const novas = await chamar(svc, {
      gravaveis: DECL.map((d) => d.nome),
      variaveisTurno: {},
      declaradas: DECL,
      texto: 'oi, tudo bem? queria entender como funciona',
    });
    expect(novas.tensao_rede).toBeUndefined();
    expect(avisos.join(' ')).toContain('gravou 0');
  });
});

/**
 * A fronteira entre as DUAS camadas: o modelo gravou `nao sei`, a rede tem o
 * número, e quem decide é a regra de ausência. Testado aqui e não só no parser
 * porque o risco mora na LIGAÇÃO — o `nao sei` do turno não pode mascarar um
 * valor concreto que o lead já tinha.
 */
describe('hesitação na gravação — as duas camadas juntas', () => {
  let svc: ConversarIaService;
  let avisos: string[];

  const DECL = parseVariaveisGravadas([
    'corrente_quadro',
    'tensao_rede: 127V | 220V | 380V | 440V | nao sei',
  ]);
  const HESITOU = 'acho que e 110 volts aqui, e o padrao antigo mesmo';

  beforeEach(() => {
    svc = Object.create(ConversarIaService.prototype) as ConversarIaService;
    avisos = [];
    Object.defineProperty(svc, 'logger', {
      value: { warn: (m: string) => avisos.push(m), log: vi.fn(), error: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  it('modelo gravou "nao sei" e a rede resgata o número dito', async () => {
    const novas = await chamar(svc, {
      gravaveis: DECL.map((d) => d.nome),
      variaveisTurno: { tensao_rede: 'nao sei' },
      declaradas: DECL,
      texto: HESITOU,
    });
    expect(novas.tensao_rede).toBe('127V');
    expect(String(novas.tensao_rede)).toContain('V'); // satisfaz o portão do C1
  });

  /**
   * ⚠️ O risco da mudança: `nao sei` virou lacuna, então a rede podia passar a
   * reescrever por cima de dado BOM que o lead já tinha. Não pode.
   */
  it('NÃO sobrescreve valor concreto que o lead já tinha', async () => {
    const novas = await chamar(svc, {
      gravaveis: DECL.map((d) => d.nome),
      variaveisTurno: { tensao_rede: 'nao sei' },
      leadVariaveis: { tensao_rede: '380V' },
      declaradas: DECL,
      texto: HESITOU,
    });
    expect(novas.tensao_rede).toBe('380V');
  });

  it('quem realmente não sabe continua sem valor inventado', async () => {
    const novas = await chamar(svc, {
      gravaveis: DECL.map((d) => d.nome),
      variaveisTurno: { tensao_rede: 'nao sei' },
      declaradas: DECL,
      texto: 'nao faco ideia, nunca olhei isso',
    });
    expect(novas.tensao_rede).toBe('nao sei');
  });
});
