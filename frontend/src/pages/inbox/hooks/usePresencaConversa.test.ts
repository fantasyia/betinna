import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePresencaConversa } from './usePresencaConversa';

// Mock do client de API pra observar os POST/DELETE de presença, sem rede real.
const post = vi.fn();
const del = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => post(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

beforeEach(() => {
  post.mockReset();
  del.mockReset();
  post.mockResolvedValue({ outros: [] });
  del.mockResolvedValue(undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePresencaConversa', () => {
  it('faz POST de presença imediato no mount', () => {
    renderHook(() => usePresencaConversa('c1'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/inbox/c1/presenca');
  });

  it('faz POST de novo a cada 20s (heartbeat)', () => {
    renderHook(() => usePresencaConversa('c1'));
    expect(post).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(post).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('faz DELETE de presença no unmount (usando o id capturado)', () => {
    const { unmount } = renderHook(() => usePresencaConversa('c1'));
    unmount();
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/inbox/c1/presenca');
  });

  it('setOutros recebe o retorno do POST', async () => {
    post.mockResolvedValue({ outros: [{ id: 'u2', nome: 'Maria' }] });
    const { result } = renderHook(() => usePresencaConversa('c1'));
    // Flush das microtasks da Promise do POST (sem sair dos fake timers).
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual([{ id: 'u2', nome: 'Maria' }]);
  });
});
