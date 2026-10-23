import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { esperaDaTentativa, useCarregarVitrine } from './carregar-vitrine';
import { EsqueletoVitrine } from './Esqueleto';

/**
 * Modo ghost da vitrine (Léo, 23/10): sem internet, esqueleto — nunca erro — e
 * volta sozinho. Só o 404 (vitrine que não existe) sai do esqueleto.
 */

function Tela({ buscar }: { buscar: () => Promise<string> }) {
  const e = useCarregarVitrine(buscar, 'loja');
  if (e.fase === 'indisponivel') return <p data-testid="indisponivel">indisponível</p>;
  if (e.fase === 'carregando') return <EsqueletoVitrine />;
  return <p data-testid="pronta">{e.dados}</p>;
}

let alvo: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  alvo = document.createElement('div');
  document.body.appendChild(alvo);
  root = createRoot(alvo);
});
afterEach(() => {
  act(() => root.unmount());
  alvo.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tem = (id: string) => alvo.querySelector(`[data-testid="${id}"]`) !== null;
async function montar(buscar: () => Promise<string>) {
  await act(async () => root.render(<Tela buscar={buscar} />));
}

describe('modo ghost', () => {
  it('servidor/rede falhou: fica no esqueleto, sem texto de erro, e tenta de novo sozinho', async () => {
    const buscar = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('vitrine');
    await montar(buscar);

    expect(tem('vt-esqueleto')).toBe(true);
    expect(alvo.textContent).not.toMatch(/erro|indispon|não foi possível/i);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(tem('pronta')).toBe(true);
  });

  it('abriu SEM internet: nem tenta; quando a internet volta, carrega na hora', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const buscar = vi.fn<() => Promise<string>>().mockResolvedValue('vitrine');
    await montar(buscar);
    expect(buscar).not.toHaveBeenCalled();
    expect(tem('vt-esqueleto')).toBe(true);

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(tem('pronta')).toBe(true);
  });

  it('vitrine que NÃO existe (404) sai do esqueleto — esperar por ela seria eterno', async () => {
    const buscar = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'não existe'));
    await montar(buscar);
    expect(tem('indisponivel')).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('o esqueleto não mostra nenhum texto na tela (só pro leitor de tela)', async () => {
    await montar(() => new Promise<string>(() => undefined));
    const visivel = Array.from(alvo.querySelectorAll('[data-testid="vt-esqueleto"] *'))
      .filter((n) => !n.classList.contains('vt-sr'))
      .map((n) => (n.childNodes.length === 1 && n.firstChild?.nodeType === 3 ? n.textContent : ''))
      .join('');
    expect(visivel).toBe('');
    expect(alvo.querySelector('[role="status"]')?.getAttribute('aria-busy')).toBe('true');
  });

  it('espera cresce até 30s e para aí', () => {
    expect([0, 1, 2, 3, 4, 9].map(esperaDaTentativa)).toEqual([
      3_000, 6_000, 12_000, 24_000, 30_000, 30_000,
    ]);
  });
});
