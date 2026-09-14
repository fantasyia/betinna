import { describe, expect, it, vi } from 'vitest';
import { avaliarCondicao } from './fluxo-executor.service';
import type { CondicaoConfig, ExecucaoContexto } from './fluxo-executor.types';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn(),
  SsrfBlockedError: class extends Error {},
}));

/**
 * "não sei" NÃO preenche campo (P1b · caso A27 · decisão do Léo em 14/09).
 *
 * O portão do C1 pergunta "Já sabemos a tensão?" comparando `custom.tensao_rede`
 * com VAZIO. E `"nao sei"` respondia que SIM — é texto, não é string vazia. O
 * fluxo seguia pra corrente e o link da calculadora saía SEM a tensão, ou seja,
 * o modelo era escolhido sem saber o padrão da rede.
 *
 * É o mesmo que comprar o equipamento sem saber a voltagem da casa: pode até
 * ligar, mas ninguém pode afirmar que protege. Sem tensão, não se dimensiona.
 *
 * ⚠️ O escopo é estreito de propósito — só comparação contra VAZIO, que é o
 * jeito que os fluxos perguntam "já temos o dado?". Portão que compara com
 * valor explícito continua exatamente como era, e é isso que os últimos testes
 * deste arquivo protegem.
 */
const ctx = (tensao: unknown): ExecucaoContexto =>
  ({ custom: { tensao_rede: tensao } }) as unknown as ExecucaoContexto;

/** O portão real do C1, copiado do grafo. */
const PORTAO_TENSAO: CondicaoConfig = {
  modo: 'simples',
  campo: 'tensao_rede',
  operador: 'neq',
  valor: '',
};

describe('portão "já temos o dado?" — o caso do C1', () => {
  it('tensão de verdade → Sim, segue', () => {
    expect(avaliarCondicao(PORTAO_TENSAO, ctx('220V'))).toBe('Sim');
  });

  it('campo vazio → Não, pergunta (como sempre foi)', () => {
    expect(avaliarCondicao(PORTAO_TENSAO, ctx(''))).toBe('Não');
  });

  it('🔴 "nao sei" → Não. Era aqui que o link saía sem tensão', () => {
    expect(avaliarCondicao(PORTAO_TENSAO, ctx('nao sei'))).toBe('Não');
  });

  it('com acento e caixa alta também ("Não sei")', () => {
    expect(avaliarCondicao(PORTAO_TENSAO, ctx('Não sei'))).toBe('Não');
  });

  it('as outras formas de ausência valem igual (o T1 grava "nao declarou")', () => {
    for (const v of ['nao declarou', 'não informado', 'Indefinido', 'n/a', '-', '?']) {
      expect(avaliarCondicao(PORTAO_TENSAO, ctx(v))).toBe('Não');
    }
  });

  it('o espelho `eq ""` responde o contrário, e coerente', () => {
    const vazio: CondicaoConfig = {
      modo: 'simples',
      campo: 'tensao_rede',
      operador: 'eq',
      valor: '',
    };
    expect(avaliarCondicao(vazio, ctx('nao sei'))).toBe('Sim');
    expect(avaliarCondicao(vazio, ctx('220V'))).toBe('Não');
  });
});

describe('o que NÃO muda — portão com valor explícito', () => {
  it('`eq "Indefinido"` continua casando "Indefinido"', () => {
    const cfg: CondicaoConfig = {
      modo: 'simples',
      campo: 'classificacao_final',
      operador: 'eq',
      valor: 'Indefinido',
    };
    const c = { custom: { classificacao_final: 'Indefinido' } } as unknown as ExecucaoContexto;
    expect(avaliarCondicao(cfg, c)).toBe('Sim');
  });

  it('`neq "nao sei"` continua sendo uma comparação literal', () => {
    const cfg: CondicaoConfig = {
      modo: 'simples',
      campo: 'tensao_rede',
      operador: 'neq',
      valor: 'nao sei',
    };
    expect(avaliarCondicao(cfg, ctx('nao sei'))).toBe('Não');
    expect(avaliarCondicao(cfg, ctx('220V'))).toBe('Sim');
  });

  it('`contains` não é portão de preenchimento e fica intacto', () => {
    const cfg: CondicaoConfig = {
      modo: 'simples',
      campo: 'tensao_rede',
      operador: 'contains',
      valor: 'sei',
    };
    expect(avaliarCondicao(cfg, ctx('nao sei'))).toBe('Sim');
  });

  it('roteador não é afetado — "nao sei" continua sendo uma saída possível', () => {
    const cfg: CondicaoConfig = {
      modo: 'roteador',
      variavel: 'tensao_rede',
      saidas: ['220V', 'nao sei'],
      operador: 'eq',
    };
    expect(avaliarCondicao(cfg, ctx('nao sei'))).toBe('nao sei');
  });
});
