import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Teste do contrato (25/09): o Léo passou DUAS vezes achando que tinha enviado.
 * O botão em destaque era "Gerar link de aceite" (que não envia nada), e depois
 * do "Enviar por e-mail" o painel FECHAVA — a confirmação sumia junto.
 */

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn(), put: vi.fn(), patch: vi.fn() },
  ApiError: class extends Error {},
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => 'DIRECTOR',
  hasPermission: () => true,
}));
vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => [() => Promise.resolve(true), null] }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
const refetchDetalhe = vi.fn();
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) =>
    path && /^\/propostas\/[^/]+$/.test(path)
      ? {
          data: {
            id: 'prop-27',
            numero: 'PROP-0027',
            status: 'RASCUNHO',
            valor: 1528,
            criadoEm: '2026-09-25T15:00:00.000Z',
            validoAte: '2026-10-24T00:00:00.000Z',
            cliente: { id: 'c1', nome: 'Cliente' },
            itens: [],
          },
          loading: false,
          error: null,
          refetch: refetchDetalhe,
        }
      : { data: [], loading: false, error: null, refetch: vi.fn() },
}));

const { PropostaDetailDrawer } = await import('./PropostasPage');

afterEach(() => {
  cleanup();
  apiPost.mockReset();
  refetchDetalhe.mockReset();
});

describe('Enviar por e-mail — o painel mostra a prova de que foi', () => {
  it('o botão em destaque é o de ENVIAR, não o de gerar link', () => {
    render(<PropostaDetailDrawer id="prop-27" onClose={vi.fn()} onChanged={vi.fn()} />);
    const enviar = screen.getByTestId('proposta-enviar-email');
    const gerar = screen.getByTestId('proposta-enviar-aceite');
    expect(enviar.className).not.toBe(gerar.className);
    expect(gerar.textContent).toContain('Gerar link de aceite');
  });

  it('depois de enviar: NÃO fecha, diz pra quem foi e mostra o link', async () => {
    apiPost.mockResolvedValue({
      ok: true,
      enviadoPara: 'pedido@somatecblocking.com.br',
      url: 'https://app.x/proposta/aceite/t',
    });
    const onChanged = vi.fn();
    const onAtualizarLista = vi.fn();
    render(
      <PropostaDetailDrawer
        id="prop-27"
        onClose={vi.fn()}
        onChanged={onChanged}
        onAtualizarLista={onAtualizarLista}
      />,
    );

    fireEvent.click(screen.getByTestId('proposta-enviar-email'));

    await waitFor(() => expect(screen.getByTestId('proposta-email-enviado')).toBeTruthy());
    expect(screen.getByTestId('proposta-email-enviado').textContent).toContain(
      'E-mail enviado para pedido@somatecblocking.com.br',
    );
    expect((screen.getByTestId('proposta-aceite-link').querySelector('input') as HTMLInputElement).value).toBe(
      'https://app.x/proposta/aceite/t',
    );
    expect(onChanged).not.toHaveBeenCalled(); // o que FECHAVA o painel
    expect(onAtualizarLista).toHaveBeenCalled();
    expect(refetchDetalhe).toHaveBeenCalled();
  });
});
