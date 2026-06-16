import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAcoesConversa } from './useAcoesConversa';

// Mock do client de API pra observar as chamadas (PATCH/POST/DELETE), sem rede real.
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('@/lib/api', async () => {
  // ApiError é usado no catch — preserva a classe real.
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      post: (...args: unknown[]) => post(...args),
      patch: (...args: unknown[]) => patch(...args),
      delete: (...args: unknown[]) => del(...args),
    },
  };
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

const refetchConv = vi.fn();
const refetchMsgs = vi.fn();
const onChanged = vi.fn();

const mount = () =>
  renderHook(() => useAcoesConversa('c1', refetchConv, refetchMsgs, onChanged));

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({});
  patch.mockReset();
  patch.mockResolvedValue({});
  del.mockReset();
  del.mockResolvedValue({ mensagens: 3 });
  toastSuccess.mockReset();
  toastError.mockReset();
  refetchConv.mockReset();
  refetchMsgs.mockReset();
  onChanged.mockReset();
});

describe('useAcoesConversa', () => {
  it('reagir faz POST /reagir e revalida as mensagens', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.reagir('m1', '👍');
    });
    expect(post).toHaveBeenCalledWith('/inbox/messages/m1/reagir', { emoji: '👍' });
    expect(refetchMsgs).toHaveBeenCalledTimes(1);
  });

  it('mudarStatus faz PATCH e chama refetchConv+onChanged', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.mudarStatus('RESOLVIDA');
    });
    expect(patch).toHaveBeenCalledWith('/inbox/c1/status', { status: 'RESOLVIDA' });
    expect(refetchConv).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('alternarBot faz o POST certo (pausar/religar) + refetchConv+onChanged', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.alternarBot('pausar');
    });
    expect(post).toHaveBeenCalledWith('/inbox/c1/bot/pausar', {});

    await act(async () => {
      await result.current.alternarBot('religar');
    });
    expect(post).toHaveBeenCalledWith('/inbox/c1/bot/religar', {});
    expect(refetchConv).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('definirBotLigado faz POST /bot/ligado com o valor (true/false/null)', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.definirBotLigado(true);
    });
    expect(post).toHaveBeenCalledWith('/inbox/c1/bot/ligado', { ligado: true });

    await act(async () => {
      await result.current.definirBotLigado(false);
    });
    expect(post).toHaveBeenCalledWith('/inbox/c1/bot/ligado', { ligado: false });

    await act(async () => {
      await result.current.definirBotLigado(null);
    });
    expect(post).toHaveBeenCalledWith('/inbox/c1/bot/ligado', { ligado: null });
    expect(refetchConv).toHaveBeenCalledTimes(3);
    expect(onChanged).toHaveBeenCalledTimes(3);
  });

  it('zerarConversa faz DELETE + refetchMsgs+refetchConv+onChanged', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.zerarConversa();
    });
    expect(del).toHaveBeenCalledWith('/inbox/c1/mensagens');
    expect(refetchMsgs).toHaveBeenCalledTimes(1);
    expect(refetchConv).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
