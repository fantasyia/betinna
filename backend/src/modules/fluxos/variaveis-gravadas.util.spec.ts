import { describe, expect, it } from 'vitest';
import {
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
