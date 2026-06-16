import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGravacaoVoz } from './useGravacaoVoz';

// ── Stubs do MediaRecorder + getUserMedia (jsdom não tem nenhum dos dois) ──

// Track espionável pra checar o release do mic (track.stop).
const trackStop = vi.fn();
let lastStream: { getTracks: () => Array<{ stop: () => void }> };

// Instância viva do MediaRecorder pra os testes dispararem onstop manualmente.
class FakeMediaRecorder {
  static lastInstance: FakeMediaRecorder | null = null;
  static isTypeSupported = vi.fn().mockReturnValue(true);
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = 'recording';
  });
  // stop NÃO dispara onstop sozinho — o teste chama dispararOnstop() pra controlar o timing.
  stop = vi.fn(() => {
    this.state = 'inactive';
  });
  pause = vi.fn(() => {
    this.state = 'paused';
  });
  resume = vi.fn(() => {
    this.state = 'recording';
  });
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.lastInstance = this;
  }
  /** Helper de teste: dispara o onstop (como o browser faria após .stop()). */
  dispararOnstop() {
    this.onstop?.();
  }
}

beforeEach(() => {
  trackStop.mockReset();
  FakeMediaRecorder.lastInstance = null;
  lastStream = { getTracks: () => [{ stop: trackStop }] };

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(lastStream),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Inicia a gravação e devolve a instância do recorder pra manipular onstop. */
async function iniciar(onGravado: (f: File) => void) {
  const hook = renderHook(() => useGravacaoVoz({ onGravado }));
  await act(async () => {
    await hook.result.current.startRecording();
  });
  return { hook, recorder: FakeMediaRecorder.lastInstance! };
}

describe('useGravacaoVoz', () => {
  it('startRecording entra no estado recording', async () => {
    const onGravado = vi.fn();
    const { hook } = await iniciar(onGravado);
    expect(hook.result.current.recording).toBe('recording');
  });

  it('stopRecording chama onGravado com um File', async () => {
    const onGravado = vi.fn();
    const { hook, recorder } = await iniciar(onGravado);
    // Alimenta um chunk pra o Blob não ficar vazio.
    act(() => {
      recorder.ondataavailable?.({ data: { size: 4 } });
    });
    act(() => {
      hook.result.current.stopRecording();
    });
    // Browser dispara onstop após o stop().
    act(() => {
      recorder.dispararOnstop();
    });
    expect(onGravado).toHaveBeenCalledTimes(1);
    expect(onGravado.mock.calls[0][0]).toBeInstanceOf(File);
    expect(hook.result.current.recording).toBe('idle');
  });

  it('cancelRecording NÃO chama onGravado (isCancellingRef)', async () => {
    const onGravado = vi.fn();
    const { hook, recorder } = await iniciar(onGravado);
    act(() => {
      recorder.ondataavailable?.({ data: { size: 4 } });
    });
    act(() => {
      hook.result.current.cancelRecording();
    });
    act(() => {
      recorder.dispararOnstop();
    });
    expect(onGravado).not.toHaveBeenCalled();
    expect(hook.result.current.recording).toBe('idle');
    // Mic liberado mesmo no cancelamento.
    expect(trackStop).toHaveBeenCalled();
  });

  it('cleanup no unmount durante gravação NÃO chama onGravado e solta os tracks', async () => {
    const onGravado = vi.fn();
    const { hook, recorder } = await iniciar(onGravado);
    act(() => {
      recorder.ondataavailable?.({ data: { size: 4 } });
    });
    // Trocar de conversa / desmontar enquanto grava.
    act(() => {
      hook.unmount();
    });
    // O teardown para o recorder; se o browser disparar o onstop, é tratado como
    // cancelamento (isCancellingRef=true) e NÃO envia.
    act(() => {
      recorder.dispararOnstop();
    });
    expect(onGravado).not.toHaveBeenCalled();
    expect(recorder.stop).toHaveBeenCalled();
    // Mic liberado pelo teardown (track.stop).
    expect(trackStop).toHaveBeenCalled();
  });

  it('onErro recebe falha de mic e limpa (null) ao iniciar', async () => {
    const onErro = vi.fn();
    const onGravado = vi.fn();
    // Primeira chamada falha (sem permissão de mic).
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Permission denied'),
    );
    const { result } = renderHook(() => useGravacaoVoz({ onGravado, onErro }));
    await act(async () => {
      await result.current.startRecording();
    });
    // Limpou ao iniciar (null) e depois reportou o erro.
    expect(onErro).toHaveBeenCalledWith(null);
    expect(onErro).toHaveBeenCalledWith(expect.stringContaining('microfone'));
    expect(result.current.recording).toBe('idle');
  });
});
