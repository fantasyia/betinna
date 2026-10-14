/**
 * PedidoDetailPage — gates de PAPEL no cancelamento (auditoria lote 6).
 *
 * O que estes testes travam:
 *  1. DIRECTOR/ADMIN cancelam DIRETO (endpoint /cancelar)
 *  2. REP/GERENTE SOLICITAM (endpoint /solicitar-cancelamento) — antes o botão
 *     era o mesmo pra todos, o rep levava 403 e ficava sem caminho nenhum
 *  3. A solicitação exige motivo (>= 5 chars); o cancelamento direto não
 *  4. Pedido CANCELADO/ENTREGUE não oferece a ação pra ninguém
 */

import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const PEDIDO = {
  id: 'ped-1',
  numero: 'PED-2026-001',
  status: 'ENVIADO_ERP',
  total: 15000,
  subtotal: 15000,
  descontoGeral: 0,
  comissao: 750,
  observacoes: null,
  criadoEm: '2026-08-01T12:00:00.000Z',
  cliente: { id: 'cli-1', nome: 'Padaria do João', cnpj: null, cidade: 'SP', erpStatus: 'ATIVO' },
  representante: { id: 'rep-1', nome: 'João', email: 'j@x.com', tetoDesconto: 10 },
  aprovador: null,
  itens: [],
  aprovacaoDesconto: null,
  pedidoOrigem: null,
};

let papel = 'DIRECTOR';
let pedidoAtual: Record<string, unknown> = PEDIDO;

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'ped-1' }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => papel,
  hasPermission: () => true,
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: pedidoAtual, loading: false, error: null, refetch: vi.fn() }),
}));

const toastError = vi.fn();
vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: toastError, info: vi.fn(), warning: vi.fn() }),
}));

const postMock = vi.fn(() => Promise.resolve({}));
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({})),
    post: (...a: unknown[]) => postMock(...(a as [])),
    put: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  ApiError: class extends Error {},
  apiErrorMessage: (e: unknown) => String(e),
}));

vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions && <div data-testid="page-actions">{actions}</div>}
      {children}
    </div>
  ),
  useIsMobile: () => false,
}));

const { default: PedidoDetailPage } = await import('./PedidoDetailPage');

afterEach(cleanup);
beforeEach(() => {
  postMock.mockClear();
  papel = 'DIRECTOR';
});

/** Abre o dialog de cancelamento e devolve o botão de confirmar. */
function abrirDialogCancelamento() {
  fireEvent.click(screen.getByTestId('pedido-page-cancelar'));
  return screen.getByTestId('pedido-page-confirmar-cancelar');
}

describe('PedidoDetailPage — cancelamento por papel', () => {
  it('DIRECTOR cancela DIRETO (POST /cancelar)', async () => {
    papel = 'DIRECTOR';
    render(<PedidoDetailPage />);

    expect(screen.getByTestId('pedido-page-cancelar').textContent).toContain('Cancelar');
    fireEvent.click(abrirDialogCancelamento());

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][0]).toBe('/pedidos/ped-1/cancelar');
  });

  it('REP vê "Solicitar cancelamento" e chama o endpoint de SOLICITAÇÃO', async () => {
    papel = 'REP';
    render(<PedidoDetailPage />);

    const botao = screen.getByTestId('pedido-page-cancelar');
    expect(botao.textContent).toContain('Solicitar cancelamento');

    fireEvent.click(botao);
    const motivo = screen.getByRole('textbox');
    fireEvent.change(motivo, { target: { value: 'cliente desistiu da compra' } });
    fireEvent.click(screen.getByTestId('pedido-page-confirmar-cancelar'));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][0]).toBe('/pedidos/ped-1/solicitar-cancelamento');
    expect(postMock.mock.calls[0][1]).toEqual({ motivo: 'cliente desistiu da compra' });
  });

  it('GERENTE também SOLICITA (não cancela direto)', () => {
    papel = 'GERENTE';
    render(<PedidoDetailPage />);
    expect(screen.getByTestId('pedido-page-cancelar').textContent).toContain(
      'Solicitar cancelamento',
    );
  });

  it('REP: confirmar fica bloqueado sem motivo (mínimo 5 caracteres)', () => {
    papel = 'REP';
    render(<PedidoDetailPage />);

    const confirmar = abrirDialogCancelamento() as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'oi' } });
    expect((screen.getByTestId('pedido-page-confirmar-cancelar') as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'estoque acabou' } });
    expect((screen.getByTestId('pedido-page-confirmar-cancelar') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('DIRECTOR: motivo é opcional (confirmar liberado de cara)', () => {
    papel = 'DIRECTOR';
    render(<PedidoDetailPage />);
    expect((abrirDialogCancelamento() as HTMLButtonElement).disabled).toBe(false);
  });

  it('pedido CANCELADO não oferece a ação pra ninguém', () => {
    papel = 'DIRECTOR';
    PEDIDO.status = 'CANCELADO';
    render(<PedidoDetailPage />);
    expect(screen.queryByTestId('pedido-page-cancelar')).toBeNull();
    PEDIDO.status = 'ENVIADO_ERP'; // restaura pros demais testes
  });
});

describe('etiqueta do Melhor Envio (Léo, 11/10)', () => {
  const comFrete = (extra: Record<string, unknown> = {}) => ({
    ...PEDIDO,
    status: 'PAGO',
    entrega: {
      servico: { id: 3, nome: '.Package', transportadora: 'Jadlog' },
      valor: 84.55,
      volumes: [{ embalagem: 'Caixa grande', pecas: 50, pesoKg: 10.2 }],
      ...extra,
    },
  });
  beforeEach(() => {
    papel = 'DIRECTOR';
    postMock.mockClear();
  });
  afterEach(() => {
    pedidoAtual = PEDIDO;
  });

  it('pago com frete do Melhor Envio: confirma a compra, chama a rota e abre a aba', async () => {
    pedidoAtual = comFrete();
    const aba = { location: { href: '' }, close: vi.fn() };
    const abrir = vi.spyOn(window, 'open').mockReturnValue(aba as unknown as Window);
    postMock.mockResolvedValueOnce({ url: 'https://melhorenvio/imprimir/x' } as never);
    render(<PedidoDetailPage />);
    fireEvent.click(screen.getByTestId('pedido-etiqueta'));
    expect(postMock).not.toHaveBeenCalled(); // primeiro confirma (debita o saldo)
    fireEvent.click(screen.getByTestId('pedido-etiqueta-confirmar'));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vitrine/admin/pedidos/ped-1/etiqueta'));
    await waitFor(() => expect(aba.location.href).toBe('https://melhorenvio/imprimir/x'));
    expect(abrir).toHaveBeenCalled();
    abrir.mockRestore();
  });

  it('recusa do Melhor Envio vira TOAST (a caixa de erro fica no fim da página — PED-0008)', async () => {
    pedidoAtual = comFrete();
    const aba = { location: { href: '' }, close: vi.fn() };
    const abrir = vi.spyOn(window, 'open').mockReturnValue(aba as unknown as Window);
    toastError.mockClear();
    postMock.mockRejectedValueOnce(new Error('O campo to.document é inválido') as never);
    render(<PedidoDetailPage />);
    fireEvent.click(screen.getByTestId('pedido-etiqueta'));
    fireEvent.click(screen.getByTestId('pedido-etiqueta-confirmar'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('A etiqueta não saiu', expect.any(String)));
    expect(aba.close).toHaveBeenCalled();
    abrir.mockRestore();
  });

  it('já comprada: "Reimprimir" vai direto, sem confirmação de compra', async () => {
    pedidoAtual = comFrete({ etiqueta: { compradaEm: '2026-10-11T19:00:00Z' } });
    const abrir = vi.spyOn(window, 'open').mockReturnValue({ location: { href: '' }, close: vi.fn() } as unknown as Window);
    postMock.mockResolvedValueOnce({ url: 'https://melhorenvio/imprimir/x' } as never);
    render(<PedidoDetailPage />);
    expect(screen.getByTestId('pedido-etiqueta').textContent).toContain('Reimprimir');
    fireEvent.click(screen.getByTestId('pedido-etiqueta'));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    abrir.mockRestore();
  });

  it('sem botão: retirada, frete a combinar, não pago ou quem não é diretor', () => {
    for (const p of [
      comFrete({ retirada: true }),
      comFrete({ freteAConfirmar: true }),
      { ...comFrete(), status: 'RASCUNHO' },
    ]) {
      pedidoAtual = p;
      render(<PedidoDetailPage />);
      expect(screen.queryByTestId('pedido-etiqueta')).toBeNull();
      cleanup();
    }
    pedidoAtual = comFrete();
    papel = 'REP';
    render(<PedidoDetailPage />);
    expect(screen.queryByTestId('pedido-etiqueta')).toBeNull();
  });
});
