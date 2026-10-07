import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Pagar o pedido na vitrine (Asaas, 07/10): Pix sem acréscimo, cartão à vista
 * sem acréscimo, parcelado com a taxa do cliente; confirmação sozinha.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  ApiError: class extends Error {
    status = 0;
  },
  apiErrorMessage: (e: unknown) => String(e),
}));

import { Pagamento, documentoOk, rotuloParcela } from './Pagamento';

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
  vi.useRealTimers();
});

const OPCOES = {
  pedido: { numero: 'PED-0007', status: 'RASCUNHO', total: 1000 },
  disponivel: true,
  motivo: null,
  pix: { valor: 1000 },
  cartao: [
    { parcelas: 1, total: 1000, parcela: 1000 },
    { parcelas: 2, total: 1036.7, parcela: 518.35 },
    { parcelas: 3, total: 1036.7, parcela: 345.57 },
  ],
  pagamento: null,
};
const PIX = {
  metodo: 'PIX',
  parcelas: 1,
  valorCobrado: 1000,
  status: 'PENDENTE',
  pix: { payload: '000201pix', imagem: 'iVBOR', expiraEm: '2026-10-08 23:59:59' },
  invoiceUrl: 'https://sandbox.asaas.com/i/pay_1',
};

function montar(extra: Partial<Parameters<typeof Pagamento>[0]> = {}) {
  const onPago = vi.fn();
  const onComecou = vi.fn();
  render(
    <Pagamento
      slug="atacado-ribelt"
      acesso={{ pedidoId: 'ped-1', token: 'tok' }}
      docInicial=""
      empresa="Ribelt"
      onPago={onPago}
      onComecou={onComecou}
      {...extra}
    />,
  );
  return { onPago, onComecou };
}

describe('helpers', () => {
  it('documento: 11 ou 14 dígitos, com ou sem máscara', () => {
    expect(documentoOk('123.456.789-09')).toBe(true);
    expect(documentoOk('12.345.678/0001-90')).toBe(true);
    expect(documentoOk('1234')).toBe(false);
  });

  it('à vista diz "sem acréscimo"; parcelado mostra parcela e total', () => {
    expect(rotuloParcela({ parcelas: 1, total: 1000, parcela: 1000 }).detalhe).toBe(
      'sem acréscimo',
    );
    const r = rotuloParcela({ parcelas: 3, total: 1036.7, parcela: 345.57 });
    expect(r.linha).toMatch(/^3x de R\$\s?345,57$/);
    expect(r.detalhe).toMatch(/total R\$\s?1\.036,70/);
  });
});

describe('<Pagamento>', () => {
  it('lê as opções com o código do pedido, sem login', async () => {
    apiGet.mockResolvedValue(OPCOES);
    montar();
    await waitFor(() => expect(screen.getByTestId('vt-pagar')).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith(
      '/public/vitrine/atacado-ribelt/pedidos/ped-1/pagamento?t=tok',
      { skipAuth: true },
    );
  });

  it('sem CPF/CNPJ não gera; com ele gera o Pix e mostra QR + copia-e-cola', async () => {
    apiGet.mockResolvedValue(OPCOES);
    apiPost.mockResolvedValue(PIX);
    const { onComecou } = montar();
    await waitFor(() => screen.getByTestId('vt-pag-gerar'));

    const gerar = screen.getByTestId('vt-pag-gerar') as HTMLButtonElement;
    expect(gerar.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('vt-pag-doc'), { target: { value: '123.456.789-09' } });
    expect(gerar.disabled).toBe(false);
    fireEvent.click(gerar);

    await waitFor(() => expect(screen.getByTestId('vt-pix')).toBeTruthy());
    expect(apiPost.mock.calls[0][1]).toEqual({
      token: 'tok',
      metodo: 'PIX',
      parcelas: 1,
      cpfCnpj: '123.456.789-09',
      email: null,
    });
    expect(onComecou).toHaveBeenCalled();
    const img = screen.getByAltText('QR Code do Pix') as HTMLImageElement;
    expect(img.src).toBe('data:image/png;base64,iVBOR');
  });

  it('cartão: escolhe 3x e manda as parcelas', async () => {
    apiGet.mockResolvedValue(OPCOES);
    apiPost.mockResolvedValue({ ...PIX, metodo: 'CARTAO', parcelas: 3, pix: null });
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    montar({ docInicial: '12345678909' });
    await waitFor(() => screen.getByTestId('vt-pag-cartao'));
    fireEvent.click(screen.getByTestId('vt-pag-cartao'));
    fireEvent.click(screen.getByText(/^3x de/));
    fireEvent.click(screen.getByTestId('vt-pag-gerar'));

    await waitFor(() => expect(screen.getByTestId('vt-cartao-aberto')).toBeTruthy());
    expect(apiPost.mock.calls[0][1]).toMatchObject({ metodo: 'CARTAO', parcelas: 3 });
    expect(abrir).toHaveBeenCalledWith('https://sandbox.asaas.com/i/pay_1', '_blank', 'noopener');
  });

  it('cobrança aberta: confere o status e mostra "confirmado" quando cai', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiGet.mockImplementation(async (url: string) =>
      url.includes('/status') ? { pago: true } : { ...OPCOES, pagamento: PIX },
    );
    const { onPago } = montar();
    await waitFor(() => screen.getByTestId('vt-pix'));
    await act(async () => {
      vi.advanceTimersByTime(5_100);
    });
    await waitFor(() => expect(screen.getByTestId('vt-pago')).toBeTruthy());
    expect(onPago).toHaveBeenCalled();
  });

  it('loja sem pagamento online: não mostra nada (segue pelo WhatsApp)', async () => {
    apiGet.mockResolvedValue({
      ...OPCOES,
      disponivel: false,
      motivo: 'Pagamento online desligado',
    });
    const { container } = render(
      <Pagamento
        slug="atacado-ribelt"
        acesso={{ pedidoId: 'ped-1', token: 'tok' }}
        docInicial=""
        empresa="Ribelt"
        onPago={vi.fn()}
        onComecou={vi.fn()}
      />,
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
