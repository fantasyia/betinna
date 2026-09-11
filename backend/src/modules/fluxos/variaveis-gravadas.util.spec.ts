import { describe, expect, it } from 'vitest';
import {
  instrucaoVariaveis,
  montarSchemaDoTurno,
  nomesDasVariaveis,
  parseVariaveisGravadas,
} from './variaveis-gravadas.util';

/**
 * O problema real: o roteador compara a variável por TEXTO LITERAL. "Não é lead"
 * tem acento e cedilha; "Nao industrial" não tem nenhum dos dois. Uma variação
 * de escrita não casa com saída nenhuma e cai no `default` — que no T1 é o ramo
 * de "bug de classificação". Erro de acento virava falso alarme de bug.
 */
describe('parseVariaveisGravadas', () => {
  it('formato antigo (só nomes) continua valendo', () => {
    expect(parseVariaveisGravadas(['regiao', 'canal'])).toEqual([
      { nome: 'regiao' },
      { nome: 'canal' },
    ]);
  });

  it('lê os valores aceitos depois do ":"', () => {
    expect(
      parseVariaveisGravadas(['perfil_energia: Industrial | Nao industrial | Indefinido']),
    ).toEqual([
      { nome: 'perfil_energia', valores: ['Industrial', 'Nao industrial', 'Indefinido'] },
    ]);
  });

  it('preserva acento, cedilha e espaço EXATAMENTE como escritos', () => {
    // É o ponto todo: o valor tem que casar caractere a caractere com a saída.
    const [v] = parseVariaveisGravadas(['classificacao_final: Não é lead | Interesse comercial']);
    expect(v.valores).toEqual(['Não é lead', 'Interesse comercial']);
  });

  it('mistura nomes livres e nomes com lista', () => {
    const r = parseVariaveisGravadas(['regiao', 'perfil: A | B']);
    expect(r).toEqual([{ nome: 'regiao' }, { nome: 'perfil', valores: ['A', 'B'] }]);
  });

  it('lista vazia depois do ":" cai pra valor livre', () => {
    expect(parseVariaveisGravadas(['x:   '])).toEqual([{ nome: 'x' }]);
  });

  it('lixo não derruba a execução (config é editada à mão e por MCP)', () => {
    expect(parseVariaveisGravadas(['', '  ', ': sem nome', 42, null, 'ok'])).toEqual([
      { nome: 'ok' },
    ]);
    expect(parseVariaveisGravadas('não é array')).toEqual([]);
    expect(parseVariaveisGravadas(undefined)).toEqual([]);
  });

  it('nomesDasVariaveis devolve só os nomes (é o que a allowlist usa)', () => {
    expect(nomesDasVariaveis(['a: X | Y', 'b'])).toEqual(['a', 'b']);
  });
});

describe('montarSchemaDoTurno', () => {
  it('sem NENHUM valor declarado, não liga structured output', () => {
    // Ligar sem enum só mudaria o comportamento de todo fluxo existente sem ganho.
    expect(montarSchemaDoTurno([{ nome: 'a' }, { nome: 'b' }])).toBeNull();
    expect(montarSchemaDoTurno([])).toBeNull();
  });

  it('variável com valores vira ENUM — é o que torna o valor errado impossível', () => {
    const schema = montarSchemaDoTurno([
      { nome: 'perfil_energia', valores: ['Industrial', 'Nao industrial'] },
    ]) as never as {
      strict: boolean;
      schema: { properties: { variaveis: { properties: Record<string, { enum?: unknown[] }> } } };
    };

    expect(schema.strict).toBe(true);
    expect(schema.schema.properties.variaveis.properties.perfil_energia.enum).toEqual([
      'Industrial',
      'Nao industrial',
      null,
    ]);
  });

  it('o enum aceita NULL — senão a IA teria que inventar classificação antes da hora', () => {
    // O nó pede "classificou: false e continue a conversa" enquanto não sabe.
    // Sem o null, o strict mode obrigaria a preencher já no primeiro turno.
    const schema = montarSchemaDoTurno([{ nome: 'p', valores: ['A'] }]) as never as {
      schema: { properties: { variaveis: { properties: Record<string, { type: string[] }> } } };
    };
    expect(schema.schema.properties.variaveis.properties.p.type).toEqual(['string', 'null']);
  });

  it('variável SEM lista, no mesmo nó, continua livre', () => {
    const schema = montarSchemaDoTurno([
      { nome: 'com_lista', valores: ['A'] },
      { nome: 'livre' },
    ]) as never as {
      schema: { properties: { variaveis: { properties: Record<string, { enum?: unknown[] }> } } };
    };
    expect(schema.schema.properties.variaveis.properties.livre.enum).toBeUndefined();
  });

  it('strict exige todo campo em required + additionalProperties false', () => {
    const schema = montarSchemaDoTurno([{ nome: 'p', valores: ['A'] }]) as never as {
      schema: {
        required: string[];
        additionalProperties: boolean;
        properties: { variaveis: { required: string[]; additionalProperties: boolean } };
      };
    };
    expect(schema.schema.required).toEqual([
      'resposta',
      'classificou',
      'classificacao',
      'variaveis',
    ]);
    expect(schema.schema.additionalProperties).toBe(false);
    expect(schema.schema.properties.variaveis.required).toEqual(['p']);
    expect(schema.schema.properties.variaveis.additionalProperties).toBe(false);
  });
});

/**
 * `instrucaoVariaveis` — o gêmeo TEXTUAL do schema.
 *
 * Existe porque os dois turnos divergiram: o de RESPOSTA montava o bloco inline,
 * o de ABERTURA montava só o schema. O schema garante a FORMA; o texto melhora a
 * ESCOLHA. O acolhimento do C1 passou a capturar dado na PRIMEIRA mensagem em
 * 11/09 — justamente o turno que não instruía.
 */
describe('instrucaoVariaveis', () => {
  it('lista as chaves que podem ser gravadas', () => {
    const txt = instrucaoVariaveis(parseVariaveisGravadas(['corrente_quadro', 'o_que_proteger']));
    expect(txt).toContain('grave APENAS estas chaves: corrente_quadro, o_que_proteger');
  });

  it('repete os valores aceitos, pro modelo ver as opções ao DECIDIR', () => {
    const txt = instrucaoVariaveis(
      parseVariaveisGravadas(['tensao_rede: 127V | 220V | 380V', 'o_que_proteger']),
    );
    expect(txt).toContain('"tensao_rede" aceita EXATAMENTE um destes: 127V | 220V | 380V');
  });

  /** Variável livre não ganha linha de enum — não há lista pra repetir. */
  it('variável sem valores aceitos não vira linha de enum', () => {
    const txt = instrucaoVariaveis(parseVariaveisGravadas(['o_que_proteger']));
    expect(txt).not.toContain('aceita EXATAMENTE');
    expect(txt).toContain('grave APENAS estas chaves: o_que_proteger');
  });

  it('lista vazia não polui o prompt', () => {
    expect(instrucaoVariaveis([])).toBe('');
    expect(instrucaoVariaveis(parseVariaveisGravadas(undefined))).toBe('');
  });

  /**
   * O texto e o schema têm que falar das MESMAS chaves. Divergir aqui é pior
   * que não instruir: o modelo recebe uma lista no texto e outra no contrato.
   */
  it('as chaves do texto batem com as do schema', () => {
    const decl = parseVariaveisGravadas(['tensao_rede: 127V | 220V', 'corrente_quadro']);
    const schema = montarSchemaDoTurno(decl) as {
      schema: { properties: { variaveis: { properties: Record<string, unknown> } } };
    };
    const doSchema = Object.keys(schema.schema.properties.variaveis.properties).sort();
    const txt = instrucaoVariaveis(decl);
    for (const chave of doSchema) expect(txt).toContain(chave);
    expect(doSchema).toEqual(['corrente_quadro', 'tensao_rede']);
  });
});

/**
 * Guarda estrutural: os DOIS turnos do nó de IA usam a mesma função.
 *
 * Foi a divergência entre eles que criou o buraco — e ela não aparece em teste
 * de comportamento, porque cada caminho isolado funciona.
 */
describe('onde a instrução textual das variáveis é usada', () => {
  /**
   * 🔴 Em 11/09 esta guarda exigia DUAS chamadas — opener e turno de resposta —
   * e a do opener foi REVERTIDA: a contagem no log de produção saiu 2/2 antes
   * da mudança e 2/5 depois. n pequeno, correlação não é causa, mas o corte cai
   * no commit e a hipótese (opener já faz duas coisas; somar instrução gasta
   * atenção no lado errado) é plausível o bastante pra medir sem ela.
   *
   * ⚠️ E a guarda antiga passou VERDE depois do revert, porque o comentário que
   * eu deixei no lugar repetia a chamada em texto,
   * e a asserção casava com o comentário. **Teste que lê fonte tem que ignorar
   * comentário** — senão ele mede o que está escrito, não o que roda.
   */
  const semComentarios = (src: string): string =>
    src
      .split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join(String.fromCharCode(10));

  it('só o turno de RESPOSTA instrui hoje — o opener está revertido e sob medição', async () => {
    const fonte = await import('node:fs').then((fs) =>
      fs.readFileSync('src/modules/fluxos/conversar-ia.service.ts', 'utf8'),
    );
    const codigo = semComentarios(fonte);
    const chamadas = codigo.split('instrucaoVariaveis(').length - 1;

    expect(
      chamadas,
      'esperado 1 chamada (turno de resposta). 2 = o opener voltou sem a medição ' +
        'que decidia; 0 = o turno de resposta também perdeu a instrução, e aí o ' +
        'schema passa a garantir só a forma, nunca a escolha.',
    ).toBe(1);
    expect(codigo).toContain('instrucaoVariaveis(declaradas)');
    expect(codigo).not.toContain('instrucaoVariaveis(declaradasAbertura)');
  });
});
