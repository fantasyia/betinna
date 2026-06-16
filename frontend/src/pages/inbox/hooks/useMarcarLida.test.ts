import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMarcarLida } from './useMarcarLida';
import type { Conversation } from '../lib/types';

// Mock do client de API pra observar o POST /marcar-lida.
const post = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...args: unknown[]) => post(...args) },
}));

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue(undefined);
});

/** Monta uma Conversation mínima com o id e as não-lidas informadas. */
const conv = (id: string, naoLidas: number) =>
  ({ id, naoLidas }) as Conversation;

describe('useMarcarLida', () => {
  it('faz POST /marcar-lida quando a conversa tem não-lidas', () => {
    renderHook(() => useMarcarLida(conv('c1', 3), 'c1'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/inbox/c1/marcar-lida');
  });

  it('NÃO re-POSTa num rerender da mesma conversa já marcada (dedup)', () => {
    const dados = conv('c1', 0);
    const { rerender } = renderHook((p: Conversation) => useMarcarLida(p, 'c1'), {
      initialProps: dados,
    });
    expect(post).toHaveBeenCalledTimes(1); // 1ª marca (mudou de id)
    rerender(dados); // mesma conversa, naoLidas=0 → dedup, não re-POSTa
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('não faz POST enquanto a conversa não carregou (convData null)', () => {
    renderHook(() => useMarcarLida(null, 'c1'));
    expect(post).not.toHaveBeenCalled();
  });
});
