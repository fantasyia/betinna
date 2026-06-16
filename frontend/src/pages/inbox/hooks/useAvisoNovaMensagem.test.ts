import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAvisoNovaMensagem } from './useAvisoNovaMensagem';

// Mock do beep pra observar quando o aviso dispara, sem Web Audio real.
const beep = vi.fn();
vi.mock('../lib/beep', () => ({ tocarBeep: () => beep() }));

/** Monta um PaginatedResponse com as não-lidas informadas (1 conversa por item). */
const resp = (naoLidas: number[]) =>
  ({
    data: naoLidas.map((n, i) => ({ id: `c${i}`, naoLidas: n })),
    pagination: { page: 1, limit: 40, total: naoLidas.length, totalPages: 1 },
  }) as never;

beforeEach(() => {
  beep.mockClear();
  localStorage.clear();
});

describe('useAvisoNovaMensagem', () => {
  it('somLigado default = true quando não há "off" no localStorage', () => {
    const { result } = renderHook((p) => useAvisoNovaMensagem(p), { initialProps: resp([0]) });
    expect(result.current.somLigado).toBe(true);
  });

  it('somLigado = false quando localStorage marca "off"', () => {
    localStorage.setItem('inbox.som', 'off');
    const { result } = renderHook((p) => useAvisoNovaMensagem(p), { initialProps: resp([0]) });
    expect(result.current.somLigado).toBe(false);
  });

  it('alternarSom desliga e persiste em localStorage', () => {
    const { result } = renderHook((p) => useAvisoNovaMensagem(p), { initialProps: resp([0]) });
    act(() => result.current.alternarSom());
    expect(result.current.somLigado).toBe(false);
    expect(localStorage.getItem('inbox.som')).toBe('off');
  });

  it('1º load JÁ com não-lidas NÃO toca beep (baseline anti-fantasma)', () => {
    renderHook((p) => useAvisoNovaMensagem(p), { initialProps: resp([3]) });
    expect(beep).not.toHaveBeenCalled();
  });

  it('quando o total de não-lidas SOBE, toca o beep', () => {
    const { rerender } = renderHook((p) => useAvisoNovaMensagem(p), { initialProps: resp([1]) });
    rerender(resp([4])); // 1 → 4 = subiu
    expect(beep).toHaveBeenCalledTimes(1);
  });

  it('quando NÃO sobe (igual ou desce), não toca beep', () => {
    const { rerender } = renderHook((p) => useAvisoNovaMensagem(p), { initialProps: resp([5]) });
    rerender(resp([2])); // desceu
    rerender(resp([2])); // igual
    expect(beep).not.toHaveBeenCalled();
  });

  it('com som desligado, não toca beep mesmo subindo', () => {
    localStorage.setItem('inbox.som', 'off');
    const { rerender } = renderHook((p) => useAvisoNovaMensagem(p), { initialProps: resp([0]) });
    rerender(resp([3]));
    expect(beep).not.toHaveBeenCalled();
  });
});
