import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnvioMensagem, type UseEnvioMensagemParams } from './useEnvioMensagem';
import type { Mensagem } from '../lib/types';

// Mock do client de API pra observar os POST de envio, sem rede real.
const post = vi.fn();
vi.mock('@/lib/api', async () => {
  // ApiError é usado no catch — preserva a classe real.
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { post: (...args: unknown[]) => post(...args) },
  };
});

// Spies pros callbacks de revalidação + setters compartilhados.
const setResposta = vi.fn();
const setRespondendoA = vi.fn();
const refetchMsgs = vi.fn();
const refetchConv = vi.fn();
const onChanged = vi.fn();

function baseParams(over: Partial<UseEnvioMensagemParams> = {}): UseEnvioMensagemParams {
  return {
    id: 'c1',
    resposta: 'oi',
    setResposta,
    respondendoA: null,
    setRespondendoA,
    outros: [],
    refetchMsgs,
    refetchConv,
    onChanged,
    ...over,
  };
}

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue(undefined);
  setResposta.mockReset();
  setRespondendoA.mockReset();
  refetchMsgs.mockReset();
  refetchConv.mockReset();
  onChanged.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useEnvioMensagem', () => {
  it('enviar() com texto vazio não posta', async () => {
    const { result } = renderHook(() => useEnvioMensagem(baseParams({ resposta: '   ' })));
    await act(async () => {
      await result.current.enviar();
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('enviar() limpa resposta e chama refetch + onChanged no sucesso', async () => {
    const { result } = renderHook(() => useEnvioMensagem(baseParams({ resposta: 'olá' })));
    await act(async () => {
      await result.current.enviar();
    });
    expect(post).toHaveBeenCalledWith('/inbox/c1/responder', { texto: 'olá' });
    expect(setResposta).toHaveBeenCalledWith('');
    expect(setRespondendoA).toHaveBeenCalledWith(null);
    expect(refetchMsgs).toHaveBeenCalledTimes(1);
    expect(refetchConv).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('enviar() inclui respondendoA quando há citação', async () => {
    const quote = { id: 'm9' } as Mensagem;
    const { result } = renderHook(() =>
      useEnvioMensagem(baseParams({ resposta: 'oi', respondendoA: quote })),
    );
    await act(async () => {
      await result.current.enviar();
    });
    expect(post).toHaveBeenCalledWith('/inbox/c1/responder', { texto: 'oi', respondendoA: 'm9' });
  });

  it('com outros.length>0 chama window.confirm e NÃO envia se cancelar', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = renderHook(() =>
      useEnvioMensagem(baseParams({ resposta: 'oi', outros: [{ id: 'u2', nome: 'Maria' }] })),
    );
    await act(async () => {
      await result.current.enviar();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('com outros.length>0 envia se o usuário confirmar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = renderHook(() =>
      useEnvioMensagem(baseParams({ resposta: 'oi', outros: [{ id: 'u2', nome: 'Maria' }] })),
    );
    await act(async () => {
      await result.current.enviar();
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('enviarMidia rejeita arquivo >12MB (sendError setado, sem POST)', async () => {
    const { result } = renderHook(() => useEnvioMensagem(baseParams()));
    // Arquivo de 13MB — acima do limite de 12MB.
    const big = new File(['x'], 'big.bin');
    Object.defineProperty(big, 'size', { value: 13 * 1024 * 1024 });
    await act(async () => {
      await result.current.enviarMidia(big, 'DOCUMENT');
    });
    expect(post).not.toHaveBeenCalled();
    expect(result.current.sendError).toMatch(/muito grande/i);
  });

  it('sending vira true durante o envio e volta a false no fim', async () => {
    // Trava o POST numa promise controlada pra observar sending=true no meio.
    let resolvePost: (() => void) | undefined;
    post.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolvePost = res;
        }),
    );
    const { result } = renderHook(() => useEnvioMensagem(baseParams({ resposta: 'oi' })));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.enviar();
    });
    // Em pleno envio: sending=true.
    expect(result.current.sending).toBe(true);
    await act(async () => {
      resolvePost?.();
      await pending;
    });
    expect(result.current.sending).toBe(false);
  });
});
