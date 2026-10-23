import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O que o ErrorBoundary manda pro Sentry.
 *
 * Versão nova com a aba aberta é condição TRATADA: a tela explica e tem botão.
 * Ia como `error`, sem dizer o caminho — e toda volta da BETINNA-FRONT-8 parecia
 * conserto falhando. Agora vai como `warning` com o caminho; erro de verdade
 * continua `error`.
 */

const captureError = vi.fn();
vi.mock('@/lib/sentry', () => ({ captureError: (...a: unknown[]) => captureError(...a) }));
const motivo = vi.fn(() => 'rascunho');
vi.mock('@/lib/lazy-com-retry', async (orig) => ({
  ...(await orig<typeof import('@/lib/lazy-com-retry')>()),
  motivoDoErroDeChunk: () => motivo(),
}));

import { ErrorBoundary } from './ErrorBoundary';

function Explode({ erro }: { erro: Error }): never {
  throw erro;
}

let alvo: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  alvo = document.createElement('div');
  document.body.appendChild(alvo);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  sessionStorage.clear();
  captureError.mockClear();
});
afterEach(() => {
  alvo.remove();
  vi.restoreAllMocks();
});

async function renderizar(erro: Error) {
  const root = createRoot(alvo);
  await act(async () => {
    root.render(
      <ErrorBoundary>
        <Explode erro={erro} />
      </ErrorBoundary>,
    );
  });
  return root;
}

describe('ErrorBoundary → Sentry', () => {
  it('chunk que sumiu: warning, com o caminho na tag', async () => {
    const root = await renderizar(new Error('Failed to fetch dynamically imported module: /x.js'));
    expect(alvo.querySelector('[data-testid="error-boundary-versao-nova"]')).not.toBeNull();
    expect(captureError).toHaveBeenCalledTimes(1);
    const [, extra, opcoes] = captureError.mock.calls[0];
    expect(extra).toMatchObject({ caminho: 'rascunho' });
    expect(opcoes).toEqual({ nivel: 'warning', tags: { caminho: 'rascunho' } });
    root.unmount();
  });

  it('erro de verdade do app continua error (sem nível rebaixado)', async () => {
    const root = await renderizar(new Error("Cannot read properties of undefined (reading 'id')"));
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][2]).toBeUndefined();
    root.unmount();
  });
});
