import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lazyComRetry, motivoDoErroDeChunk, trazerVersaoNova } from './lazy-com-retry';
import { limparMarcadores, marcarSujo } from './dirty';
import { agendarChecagemDeVersao } from './pwa-checagem';

/**
 * BETINNA-FRONT-8 voltou em 07/10 (card cmuxpgxs60094ll5iodmzag96).
 *
 * O `lazyComRetry` recarregava contando que o reload trouxesse o index.html
 * NOVO. Só que o index está no precache do service worker: com o SW velho no
 * controle, o reload devolvia o MESMO index velho, o import falhava de novo e a
 * pessoa caía na tela de erro. Estes testes travam a ORDEM: primeiro o SW novo
 * assume, depois recarrega.
 */

const carregar = (componente: unknown): Promise<unknown> =>
  (componente as { _payload: { _result: () => Promise<unknown> } })._payload._result();

let ordem: string[] = [];

/** SW dublê: `update()` acha uma versão nova instalando, que passa a installed → activated. */
function swComVersaoNova(opcoes: { travar?: boolean } = {}) {
  const ouvintes: Array<() => void> = [];
  const novo = {
    state: 'installing' as string,
    postMessage: vi.fn((msg: { type: string }) => {
      ordem.push(`sw:${msg.type}`);
      if (opcoes.travar) return;
      queueMicrotask(() => {
        novo.state = 'activated';
        ordem.push('sw:activated');
        ouvintes.forEach((f) => f());
      });
    }),
    addEventListener: (_: string, f: () => void) => ouvintes.push(f),
  };
  const reg = {
    installing: null as typeof novo | null,
    waiting: null as typeof novo | null,
    update: vi.fn(async () => {
      ordem.push('sw:update');
      reg.installing = novo;
      queueMicrotask(() => {
        novo.state = 'installed';
        ouvintes.forEach((f) => f());
      });
    }),
  };
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { getRegistration: async () => reg },
  });
  return { reg, novo };
}

beforeEach(() => {
  ordem = [];
  sessionStorage.clear();
  limparMarcadores();
  vi.stubGlobal('location', { ...window.location, reload: () => ordem.push('reload') });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('antes de recarregar, a versão nova do SW assume', () => {
  it('ordem: update → SKIP_WAITING → activated → SÓ ENTÃO reload', async () => {
    swComVersaoNova();
    const Comp = lazyComRetry(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    void carregar(Comp);
    await vi.waitFor(() => expect(ordem).toContain('reload'));
    expect(ordem).toEqual(['sw:update', 'sw:SKIP_WAITING', 'sw:activated', 'reload']);
  });

  it('SW travado: recarrega mesmo assim depois do teto (não fica preso)', async () => {
    vi.useFakeTimers();
    swComVersaoNova({ travar: true });
    const Comp = lazyComRetry(() => Promise.reject(new Error('Failed to fetch')));
    void carregar(Comp);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(ordem).not.toContain('reload');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(ordem).toContain('reload');
  });

  it('sem service worker no navegador: recarrega direto', async () => {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: undefined });
    await trazerVersaoNova();
    const Comp = lazyComRetry(() => Promise.reject(new Error('Failed to fetch')));
    void carregar(Comp);
    await vi.waitFor(() => expect(ordem).toEqual(['reload']));
  });
});

describe('o Sentry fica sabendo QUAL caminho levou à tela de versão nova', () => {
  it('já tinha recarregado nesta aba', async () => {
    sessionStorage.setItem('betinna:recarregou-por-chunk', '1');
    await expect(carregar(lazyComRetry(() => Promise.reject(new Error('x'))))).rejects.toThrow();
    expect(motivoDoErroDeChunk()).toBe('ja-recarregou');
  });

  it('tinha rascunho não salvo', async () => {
    marcarSujo('editor-fluxo', true);
    await expect(carregar(lazyComRetry(() => Promise.reject(new Error('x'))))).rejects.toThrow();
    expect(motivoDoErroDeChunk()).toBe('rascunho');
  });

  it('storage bloqueado', async () => {
    const joga = () => {
      throw new Error('bloqueado');
    };
    vi.stubGlobal('sessionStorage', { getItem: joga, setItem: joga, removeItem: joga });
    await expect(carregar(lazyComRetry(() => Promise.reject(new Error('x'))))).rejects.toThrow();
    expect(motivoDoErroDeChunk()).toBe('sem-storage');
  });
});

describe('aba parada confere versão nova sozinha', () => {
  it('a cada intervalo, com a aba visível e online, pede update ao SW', async () => {
    vi.useFakeTimers();
    const reg = { update: vi.fn().mockResolvedValue(undefined) };
    const parar = agendarChecagemDeVersao(reg, 1_000);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(reg.update).toHaveBeenCalledTimes(2);
    parar();
  });

  it('aba escondida ou offline: não confere', async () => {
    vi.useFakeTimers();
    const reg = { update: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const parar = agendarChecagemDeVersao(reg, 1_000);
    await vi.advanceTimersByTimeAsync(1_100);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(reg.update).not.toHaveBeenCalled();
    parar();
  });
});

describe('fiação', () => {
  /**
   * O `registerSW` vem de um módulo virtual que só existe no build — não dá pra
   * importar o pwa.ts aqui. Então confere no fonte: a checagem periódica tem que
   * estar no `onRegisteredSW`, senão ela existe e nunca roda.
   */
  it('a checagem periódica está ligada no registro do service worker', () => {
    const fonte = readFileSync(join(__dirname, 'pwa.ts'), 'utf8');
    expect(fonte).toMatch(/onRegisteredSW\([^)]*\)\s*\{[^}]*agendarChecagemDeVersao\(reg\)/);
  });

  /** Não só o App.tsx: o `FluxoEditor` (FluxosPage) ficou com `lazy()` cru até 22/10. */
  it('nenhum arquivo do src usa `lazy()` cru fora do helper', () => {
    const raiz = join(__dirname, '..');
    const crus: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p);
        else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !p.endsWith('lazy-com-retry.ts')) {
          if (/=\s*lazy\(/.test(readFileSync(p, 'utf8'))) crus.push(p.slice(raiz.length));
        }
      }
    };
    varrer(raiz);
    expect(crus).toEqual([]);
  });
});
