import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ehErroDeChunk, jaRecarregouPorChunk, lazyComRetry } from './lazy-com-retry';
import { limparMarcadores, marcarSujo } from './dirty';

/**
 * Deploy com a aba aberta.
 *
 * ⚠️ O que estes testes protegem é o COMPORTAMENTO NA FALHA — recarregar uma
 * vez, e só uma. Um `lazy()` normal passaria em qualquer teste de caminho
 * feliz, porque no caminho feliz os dois são idênticos. O defeito mora inteiro
 * no `catch`.
 */
const CHAVE = 'betinna:recarregou-por-chunk';

/** `lazy()` só chama o import dentro do render. Aqui puxamos o que ele guarda. */
const carregar = (componente: unknown): Promise<unknown> =>
  (componente as { _payload: { _result: () => Promise<unknown> } })._payload._result();

let recarregou = 0;

beforeEach(() => {
  recarregou = 0;
  sessionStorage.clear();
  limparMarcadores();
  // `location.reload` é não-configurável no jsdom — spyOn estoura com
  // "Cannot redefine property". Trocar o objeto inteiro é o caminho que
  // funciona, e `window === globalThis` aqui, então o código de produção
  // (que chama `window.location.reload()`) enxerga o dublê.
  vi.stubGlobal('location', {
    ...window.location,
    reload: () => {
      recarregou++;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ehErroDeChunk', () => {
  it('reconhece o texto das TRÊS engines', () => {
    // Chrome, Firefox e Safari escrevem diferente pra mesma falha. Reconhecer
    // só a do Chrome deixaria o aviso errado em metade dos navegadores.
    expect(
      ehErroDeChunk(new Error('Failed to fetch dynamically imported module: https://x/a.js')),
    ).toBe(true);
    expect(ehErroDeChunk(new Error('error loading dynamically imported module'))).toBe(true);
    expect(ehErroDeChunk(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('não confunde erro comum do app com chunk que sumiu', () => {
    expect(ehErroDeChunk(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(ehErroDeChunk(undefined)).toBe(false);
  });
});

describe('lazyComRetry', () => {
  it('no caminho feliz entrega o módulo e NÃO recarrega', async () => {
    const Comp = lazyComRetry(async () => ({ default: (() => null) as never }));
    await carregar(Comp);
    expect(recarregou).toBe(0);
  });

  it('import que falha recarrega a página UMA vez', async () => {
    const Comp = lazyComRetry(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module: /x.js')),
    );
    // Não resolve de propósito — a página está indo embora.
    void carregar(Comp);
    await Promise.resolve();
    await Promise.resolve();

    expect(recarregou).toBe(1);
    expect(sessionStorage.getItem(CHAVE)).toBe('1');
  });

  it('🔴 com a marca posta NÃO recarrega de novo — laço de reload é pior que tela de erro', async () => {
    sessionStorage.setItem(CHAVE, '1');
    const Comp = lazyComRetry(() => Promise.reject(new Error('Failed to fetch')));

    await expect(carregar(Comp)).rejects.toThrow();
    expect(recarregou).toBe(0);
  });

  it('NÃO recarrega por cima de alteração não salva', async () => {
    // A recarga levaria o rascunho junto, calada — que é exatamente o que a
    // guarda do main.tsx existe pra impedir.
    marcarSujo('editor-fluxo', true);
    const Comp = lazyComRetry(() => Promise.reject(new Error('Failed to fetch')));

    await expect(carregar(Comp)).rejects.toThrow();
    expect(recarregou).toBe(0);
    // Mas marca, pra quando a pessoa recarregar na mão não entrar em laço.
    expect(jaRecarregouPorChunk()).toBe(true);
  });

  it('recarrega mesmo quando o texto do erro NÃO é conhecido', async () => {
    // Deliberado: texto de erro é por engine e muda com versão de browser. Não
    // reconhecer uma string não pode custar o conserto.
    const Comp = lazyComRetry(() => Promise.reject(new Error('vixe')));
    void carregar(Comp);
    await Promise.resolve();
    await Promise.resolve();
    expect(recarregou).toBe(1);
  });

  it('🔴 storage bloqueado NÃO recarrega — sem dedupe, reload vira laço infinito', async () => {
    // Aba anônima / cookies bloqueados: `sessionStorage` JOGA em vez de
    // devolver null. Sem a marca não dá pra garantir "uma vez só", e recarregar
    // assim mesmo prende a pessoa num laço do qual ela não sai — pior que a
    // tela de erro que estamos consertando. Falhar fechado é a escolha certa
    // aqui: perde-se o conserto, não a página.
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('storage bloqueado');
      },
      setItem: () => {
        throw new Error('storage bloqueado');
      },
      removeItem: () => {
        throw new Error('storage bloqueado');
      },
    });
    const Comp = lazyComRetry(() => Promise.reject(new Error('Failed to fetch')));

    await expect(carregar(Comp)).rejects.toThrow();
    expect(recarregou).toBe(0);
  });

  it('sucesso LIMPA a marca — senão o conserto vale uma vez por aba', async () => {
    sessionStorage.setItem(CHAVE, '1');
    const Comp = lazyComRetry(async () => ({ default: (() => null) as never }));
    await carregar(Comp);
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });
});

describe('fiação', () => {
  /**
   * ESTRUTURAL: sem isto, alguém acrescenta uma rota nova com `lazy()` cru e
   * ela volta a quebrar no deploy — com a suíte inteira verde, porque todos os
   * testes acima continuam passando.
   */
  it('nenhuma rota do App.tsx usa `lazy()` cru', () => {
    const fonte = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
    const crus = fonte.match(/=\s*lazy\(/g) ?? [];
    expect(crus).toHaveLength(0);
    expect(fonte).toContain('lazyComRetry');
  });
});
