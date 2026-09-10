import { describe, expect, it } from 'vitest';
import { FluxosService } from './fluxos.service';
import { OPERADORES_CONDICAO } from './fluxo-executor.service';

/**
 * Operador desconhecido é FALHA, não é "Não".
 *
 * Em 10/09 eu gravei `operador: "equals"` em três portões do E6 — o nome
 * "natural", e o motor só conhece `eq`. O `fluxos_atualizar` aceitou, e os três
 * passaram a responder "Não" **sem erro, sem log, e com o passo fechando
 * VERDE**. O E6 ficou ATIVO, executando, concluindo, e nenhum e-mail de
 * carrinho abandonado saiu por horas.
 *
 * ⚠️ E "Não" não é neutro — é o que faz isto ser grave nos dois sentidos:
 *
 *   portão "ainda está no checkout?"  → "Não" FECHA a régua (ninguém recebe)
 *   guarda "pediu pra sair?"          → "Não" ABRE a régua (opt-out atropelado)
 *
 * Duas camadas, porque pegam momentos diferentes: a validação impede ENTRAR (e
 * quem editou lê o nome certo na hora), e o throw no executor pega o que JÁ
 * está gravado. O tipo é união fechada só em TypeScript e o `config` do nó é
 * objeto livre no schema — nenhuma das duas é dispensável.
 */
const chamar = (config: Record<string, unknown>) =>
  (
    FluxosService.prototype as unknown as {
      validarCondicao: (
        no: { id: string; titulo?: string; config?: unknown },
        arestas: { sourceNoId: string; label?: string | null }[],
      ) => void;
    }
  ).validarCondicao({ id: 'no-1', titulo: 'Ainda em Checkout iniciado?', config }, [
    { sourceNoId: 'no-1', label: 'Sim' },
    { sourceNoId: 'no-1', label: 'Não' },
  ]);

describe('validação: operador da condição', () => {
  it('aceita os sete que o motor conhece', () => {
    for (const op of OPERADORES_CONDICAO) {
      expect(() => chamar({ modo: 'simples', campo: 'lead.etapa_id', operador: op })).not.toThrow();
    }
  });

  // O caso exato que derrubou o E6.
  it('RECUSA "equals" — foi ele que desligou o E6 em silêncio', () => {
    expect(() =>
      chamar({ modo: 'simples', campo: 'lead.etapa_id', operador: 'equals', valor: 'fet_x' }),
    ).toThrow(/não conhece/);
  });

  it('a mensagem diz o que usar, não só que está errado', () => {
    expect(() => chamar({ modo: 'simples', campo: 'lead.origem', operador: 'equals' })).toThrow(
      /Use um destes: eq, neq/,
    );
  });

  it('e diz o estrago, pra quem lê entender a urgência', () => {
    expect(() => chamar({ modo: 'simples', campo: 'x', operador: 'equals' })).toThrow(
      /responderia "Não" para sempre/,
    );
  });

  it('recusa outros nomes plausíveis que o motor não tem', () => {
    for (const op of ['equal', 'includes', 'notEquals', '===', 'ne', 'like']) {
      expect(() => chamar({ modo: 'simples', campo: 'x', operador: op })).toThrow(/não conhece/);
    }
  });

  it('operador com espaço em volta é aceito se o nome for válido', () => {
    expect(() => chamar({ modo: 'simples', campo: 'x', operador: ' eq ' })).not.toThrow();
  });

  // O modo roteador não usa operador — a validação dele é outra e não pode
  // passar a exigir um campo que ele nunca teve.
  it('modo roteador segue sem exigir operador', () => {
    expect(() =>
      (
        FluxosService.prototype as unknown as {
          validarCondicao: (
            no: { id: string; titulo?: string; config?: unknown },
            arestas: { sourceNoId: string; label?: string | null }[],
          ) => void;
        }
      ).validarCondicao(
        {
          id: 'no-r',
          titulo: 'Roteador',
          config: { modo: 'roteador', variavel: 'desfecho', saidas: ['a', 'b'] },
        },
        [
          { sourceNoId: 'no-r', label: 'a' },
          { sourceNoId: 'no-r', label: 'b' },
        ],
      ),
    ).not.toThrow();
  });

  it('operador ausente continua recusado, com a mensagem antiga', () => {
    expect(() => chamar({ modo: 'simples', campo: 'x' })).toThrow(/incompleta/);
  });
});

/**
 * O executor: o que já está GRAVADO com operador inválido tem que estourar,
 * não responder "Não". Passo `FALHOU` é visível — fica vermelho no painel,
 * entra no log e conta como erro. Um "Não" plausível não é observável.
 */
describe('executor: operador da condição', () => {
  it('a lista canônica é exportada e tem os sete', () => {
    expect([...OPERADORES_CONDICAO].sort()).toEqual(
      ['contains', 'eq', 'gt', 'gte', 'lt', 'lte', 'neq'].sort(),
    );
  });

  it('a lista existe como VALOR, não só como tipo — a checagem é em runtime', () => {
    // O `config` do nó é objeto livre no schema: sem lista em runtime, qualquer
    // string entraria pelo importar/atualizar e pelo editor.
    expect(OPERADORES_CONDICAO).toBeInstanceOf(Set);
    expect(OPERADORES_CONDICAO.has('equals')).toBe(false);
  });
});

// Guarda contra o modo de falha da própria correção: se alguém adicionar um
// operador no `switch` do executor e esquecer a lista, a validação passaria a
// recusar um operador que funciona.
describe('a lista e o switch não podem divergir', () => {
  it('todo operador da lista é tratado no switch do executor', async () => {
    const fonte = await import('node:fs').then((fs) =>
      fs.readFileSync('src/modules/fluxos/fluxo-executor.service.ts', 'utf8'),
    );
    for (const op of OPERADORES_CONDICAO) {
      expect(fonte).toContain(`case '${op}':`);
    }
  });

  it('e o switch não tem case fora da lista', async () => {
    const fonte = await import('node:fs').then((fs) =>
      fs.readFileSync('src/modules/fluxos/fluxo-executor.service.ts', 'utf8'),
    );
    // Só o trecho do switch de operadores, delimitado pelo default que estoura.
    const inicio = fonte.indexOf('switch (config.operador)');
    const fim = fonte.indexOf('OPERADORES_CONDICAO].join', inicio);
    const trecho = fonte.slice(inicio, fim);
    const cases = [...trecho.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]);
    expect(cases.sort()).toEqual([...OPERADORES_CONDICAO].sort());
  });
});
