import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTagsConversa } from './useTagsConversa';
import type { Conversation } from '../lib/types';

// Mock do client de API pra observar o PUT /tags, sem rede real.
const put = vi.fn();
vi.mock('@/lib/api', async () => {
  // ApiError é usado no catch — preserva a classe real.
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { put: (...args: unknown[]) => put(...args) },
  };
});

// Toast só pra silenciar os avisos de validação (tag longa/limite).
const toastError = vi.fn();
vi.mock('@/components/toast', () => ({
  useToast: () => ({ error: toastError, success: vi.fn() }),
}));

const refetchConv = vi.fn();
const onChanged = vi.fn();

/** Monta uma Conversation mínima com as tags informadas. */
const conv = (tags: string[]) => ({ id: 'c1', tagsInternas: tags }) as Conversation;

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({ tagsInternas: [] });
  toastError.mockReset();
  refetchConv.mockReset();
  onChanged.mockReset();
});

describe('useTagsConversa', () => {
  it('tagsAtuais reflete convData.tagsInternas (e [] quando ausente)', () => {
    const { result } = renderHook(() => useTagsConversa(conv(['vip']), 'c1', refetchConv, onChanged));
    expect(result.current.tagsAtuais).toEqual(['vip']);

    const vazio = renderHook(() => useTagsConversa(null, 'c1', refetchConv, onChanged));
    expect(vazio.result.current.tagsAtuais).toEqual([]);
  });

  it('adicionarTag posta a lista COMPLETA com a nova e chama refetchConv+onChanged', async () => {
    const { result } = renderHook(() =>
      useTagsConversa(conv(['vip']), 'c1', refetchConv, onChanged),
    );
    act(() => result.current.setNovaTag('urgente'));
    await act(async () => {
      await result.current.adicionarTag();
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/inbox/c1/tags', { tags: ['vip', 'urgente'] });
    expect(refetchConv).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('adicionarTag limpa novaTag no sucesso', async () => {
    const { result } = renderHook(() => useTagsConversa(conv([]), 'c1', refetchConv, onChanged));
    act(() => result.current.setNovaTag('nova'));
    await act(async () => {
      await result.current.adicionarTag();
    });
    expect(result.current.novaTag).toBe('');
  });

  it('rejeita tag vazia (só espaços) — não posta', async () => {
    const { result } = renderHook(() => useTagsConversa(conv([]), 'c1', refetchConv, onChanged));
    act(() => result.current.setNovaTag('   '));
    await act(async () => {
      await result.current.adicionarTag();
    });
    expect(put).not.toHaveBeenCalled();
  });

  it('rejeita tag > 30 chars — não posta', async () => {
    const { result } = renderHook(() => useTagsConversa(conv([]), 'c1', refetchConv, onChanged));
    act(() => result.current.setNovaTag('x'.repeat(31)));
    await act(async () => {
      await result.current.adicionarTag();
    });
    expect(put).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('rejeita tag duplicada case-insensitive — não posta e limpa novaTag', async () => {
    const { result } = renderHook(() =>
      useTagsConversa(conv(['VIP']), 'c1', refetchConv, onChanged),
    );
    act(() => result.current.setNovaTag('vip'));
    await act(async () => {
      await result.current.adicionarTag();
    });
    expect(put).not.toHaveBeenCalled();
    expect(result.current.novaTag).toBe('');
  });

  it('rejeita acima de 12 tags — não posta', async () => {
    const cheio = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const { result } = renderHook(() =>
      useTagsConversa(conv(cheio), 'c1', refetchConv, onChanged),
    );
    act(() => result.current.setNovaTag('extra'));
    await act(async () => {
      await result.current.adicionarTag();
    });
    expect(put).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('removerTag posta a lista SEM a tag', async () => {
    const { result } = renderHook(() =>
      useTagsConversa(conv(['vip', 'urgente']), 'c1', refetchConv, onChanged),
    );
    await act(async () => {
      await result.current.removerTag('vip');
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/inbox/c1/tags', { tags: ['urgente'] });
    expect(refetchConv).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
