import { describe, expect, it, vi } from 'vitest';
import { FluxosService } from './fluxos.service';
import { FluxoExecutorService, OPERADORES_CONDICAO } from './fluxo-executor.service';

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

/**
 * A mensagem tem que chegar LEGÍVEL no `erroMsg` do passo — é literalmente o
 * que alguém vai ler na tela do fluxo às 3 da manhã (o V.8 pinta `FALHOU` em
 * vermelho com o `erroMsg`).
 *
 * "O fluxo quebrou" e "o fluxo quebrou AQUI, por ISTO" custam o mesmo pra
 * produzir e não custam o mesmo pra quem está de plantão.
 */
describe('o FALHOU diz o que aconteceu', () => {
  const makeService = () => {
    const prisma = {
      fluxoExecucao: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'exec-1',
          fluxoId: 'fluxo-1',
          empresaId: 'emp-1',
          status: 'EM_EXECUCAO',
          contexto: {},
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      fluxo: { findUnique: vi.fn().mockResolvedValue({ triggerTipo: 'LEAD_RECEBEU_TAG' }) },
      fluxoNo: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'no-1',
          fluxoId: 'fluxo-1',
          tipo: 'CONDICAO',
          acaoTipo: null,
          titulo: 'Ainda em Checkout iniciado? — após 1 dia',
          config: {
            modo: 'simples',
            campo: 'lead.etapa_id',
            operador: 'equals',
            valor: 'fet_addaa8ecf6794a8adb375e50',
          },
        }),
      },
      fluxoEdge: { findMany: vi.fn().mockResolvedValue([]) },
      fluxoExecucaoLog: {
        create: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      fluxoStepClaim: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      usuario: { findFirst: vi.fn().mockResolvedValue(null) },
      lead: { findFirst: vi.fn().mockResolvedValue(null) },
      pedido: { findFirst: vi.fn().mockResolvedValue(null) },
      cliente: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (o: unknown[]) => Promise.all(o as Promise<unknown>[])),
    };
    const service = new FluxoExecutorService(
      prisma as never,
      { get: vi.fn().mockReturnValue('') } as never,
      {} as never,
      { enviarTexto: vi.fn(), enviarMidia: vi.fn(), estaDisponivel: vi.fn() } as never,
      { enviarHtmlLivre: vi.fn() } as never,
      { iniciar: vi.fn() } as never,
      { disparar: vi.fn() } as never,
      { aguardarSlot: vi.fn(), esperaAntesDoProativoMs: vi.fn().mockResolvedValue(0) } as never,
      { marcarDesconectado: vi.fn() } as never,
      { add: vi.fn().mockResolvedValue({ id: 'j' }) } as never,
      { criarCardsDeTarefa: vi.fn(async () => ({})) } as never,
      { suprimido: vi.fn(async () => false) } as never,
      { criar: vi.fn() } as never,
      { processarMensagemEntrante: vi.fn().mockResolvedValue({}) } as never,
    );
    return { service, prisma };
  };

  it('o passo fica FALHOU, não CONCLUIDO com "Não"', async () => {
    const { service, prisma } = makeService();
    await expect(service.executarPasso('exec-1', 'no-1', 'job-1')).rejects.toThrow();
    const log = prisma.fluxoExecucaoLog.create.mock.calls.at(-1)?.[0] as {
      data?: { status?: string };
    };
    expect(log?.data?.status).toBe('FALHOU');
  });

  /**
   * O QUE se lê na tela vem de DUAS colunas do log, não de uma: `noTitulo` diz
   * QUAL nó, `erroMsg` diz O QUE aconteceu. Testar as duas juntas é o que
   * garante a leitura de plantão — num fluxo com três portões iguais ("após 1
   * dia", "após 3 dias", "após 6 dias"), a mensagem sozinha não bastaria.
   */
  it('o log identifica QUAL nó e O QUE aconteceu', async () => {
    const { service, prisma } = makeService();
    await expect(service.executarPasso('exec-1', 'no-1', 'job-1')).rejects.toThrow();
    const log = prisma.fluxoExecucaoLog.create.mock.calls.at(-1)?.[0] as {
      data?: { noTitulo?: string; erroMsg?: string };
    };
    // qual nó
    expect(log?.data?.noTitulo).toBe('Ainda em Checkout iniciado? — após 1 dia');
    // o que aconteceu: nomeia o operador errado e lista os certos
    const msg = log?.data?.erroMsg ?? '';
    expect(msg).toContain('equals');
    expect(msg).toMatch(/eq, neq/);
    // e não é exceção genérica
    expect(msg).not.toMatch(/^Error$|internal|unexpected/i);
  });
});
