import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollToBottom } from './useScrollToBottom';

// jsdom não implementa scrollIntoView — stubamos pra observar as chamadas.
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Renderiza o hook e ancora o ref num <div> real com scrollIntoView stubado,
 * pra que `endRef.current?.scrollIntoView(...)` realmente dispare o spy.
 */
function montar(lastMsgId: string | null) {
  const view = renderHook((p: string | null) => useScrollToBottom(p), {
    initialProps: lastMsgId,
  });
  const div = document.createElement('div');
  div.scrollIntoView = scrollIntoView;
  // Liga o ref retornado pelo hook ao elemento stub.
  (view.result.current as { current: HTMLDivElement | null }).current = div;
  return view;
}

describe('useScrollToBottom', () => {
  it('chama scrollIntoView quando lastMsgId muda', () => {
    const { rerender } = montar('m1');
    scrollIntoView.mockReset(); // ignora o efeito do mount inicial
    act(() => {
      rerender('m2'); // id mudou → deve rolar
    });
    expect(scrollIntoView).toHaveBeenCalled();
    // E o scroll de segurança após 400ms também roda.
    const antes = scrollIntoView.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(antes);
  });

  it('NÃO chama scrollIntoView num rerender com o MESMO lastMsgId (anti-arrasto)', () => {
    const { rerender } = montar('m1');
    act(() => {
      vi.advanceTimersByTime(400); // drena o timer do mount
    });
    scrollIntoView.mockReset();
    act(() => {
      rerender('m1'); // mesmo id → efeito NÃO re-executa
      vi.advanceTimersByTime(400);
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
