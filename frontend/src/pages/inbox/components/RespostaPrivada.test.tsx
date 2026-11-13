import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Resposta privada a comentário de FB/IG (13/11). */

const post = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { RespostaPrivada } from './RespostaPrivada';

afterEach(() => {
  cleanup();
  post.mockReset();
});

describe('<RespostaPrivada>', () => {
  it('abre o diálogo, não envia vazio e manda o texto pra rota da conversa', async () => {
    post.mockResolvedValue({});
    const onEnviada = vi.fn();
    render(<RespostaPrivada conversationId="conv-1" onEnviada={onEnviada} />);
    fireEvent.click(screen.getByTestId('inbox-responder-privado-btn'));
    const enviar = screen.getByTestId('inbox-responder-privado-enviar') as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('inbox-responder-privado-texto'), {
      target: { value: '  Oi! Te chamo aqui  ' },
    });
    expect(enviar.disabled).toBe(false);
    fireEvent.click(enviar);
    await waitFor(() => expect(onEnviada).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/inbox/conv-1/responder-privado', {
      texto: 'Oi! Te chamo aqui',
    });
  });
});
