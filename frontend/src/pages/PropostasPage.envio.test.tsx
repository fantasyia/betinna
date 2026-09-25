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
let envioNoServidor: unknown = null;
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) =>
    path?.endsWith('/envio')
      ? { data: envioNoServidor, loading: false, error: null, refetch: vi.fn() }
      : path && /^\/propostas\/[^/]+$/.test(path)
      ? {
          data: {
            id: 'prop-27',
            numero: 'PROP-0027',
            status: 'RASCUNHO',
            modalidade: 'LOCACAO',
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
  envioNoServidor = null;
});

describe('Enviar por e-mail — o painel mostra a prova de que foi', () => {
  it('só existe o ENVIAR por e-mail — o "Gerar link de aceite" saiu (Léo, 25/09)', () => {
    render(<PropostaDetailDrawer id="prop-27" onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByTestId('proposta-enviar-email')).toBeTruthy();
    expect(screen.queryByTestId('proposta-enviar-aceite')).toBeNull();
    expect(document.body.textContent).not.toContain('Gerar link de aceite');
    expect(screen.getByTestId('proposta-projeto').textContent).toContain(
      'Levantamento técnico de projeto',
    );
  });

  it('reabrir o painel de proposta já enviada: mostra pra quem, quando, e o link — sem reenviar', () => {
    envioNoServidor = {
      ok: true,
      jaEnviado: true,
      enviadoPara: 'pedido@somatecblocking.com.br',
      enviadoEm: '2026-09-25T22:04:00.000Z',
      url: 'https://app.x/proposta/aceite/t',
      expiraEm: '2026-10-02T22:04:00.000Z',
    };
    render(<PropostaDetailDrawer id="prop-27" onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByTestId('proposta-email-enviado').textContent).toContain(
      'E-mail enviado para pedido@somatecblocking.com.br em 25/09 às 19:04',
    );
    const bloco = screen.getByTestId('proposta-aceite-link').textContent ?? '';
    expect(bloco).toContain('Ao aceitar, o contrato vai pra assinatura.');
    expect(bloco).not.toContain('um pedido é criado');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('clicar de novo com o e-mail já enviado: mostra o link, não diz que enviou de novo', async () => {
    apiPost.mockResolvedValue({
      ok: true,
      jaEnviado: true,
      enviadoPara: 'pedido@somatecblocking.com.br',
      enviadoEm: '2026-09-25T22:04:00.000Z',
      url: 'https://app.x/proposta/aceite/t',
      expiraEm: '2026-10-02T22:04:00.000Z',
    });
    const onAtualizarLista = vi.fn();
    render(
      <PropostaDetailDrawer
        id="prop-27"
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onAtualizarLista={onAtualizarLista}
      />,
    );
    fireEvent.click(screen.getByTestId('proposta-enviar-email'));
    await waitFor(() => expect(screen.getByTestId('proposta-email-enviado')).toBeTruthy());
    expect(onAtualizarLista).not.toHaveBeenCalled();
  });

  it('depois de enviar: NÃO fecha, diz pra quem foi e mostra o link', async () => {
    apiPost.mockResolvedValue({
      ok: true,
      jaEnviado: false,
      enviadoPara: 'pedido@somatecblocking.com.br',
      enviadoEm: '2026-09-25T22:04:00.000Z',
      url: 'https://app.x/proposta/aceite/t',
      expiraEm: '2026-10-02T22:04:00.000Z',
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
