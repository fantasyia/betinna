import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * CNPJ já cadastrado (24/09): o formulário avisa NA HORA e oferece o cadastro
 * existente, em vez de deixar preencher tudo pra o backend recusar a duplicata.
 */

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn(), patch: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/components/LocalidadeSelects', () => ({
  UfSelect: () => <select />,
  CidadeSelect: () => <select />,
}));

import { ClienteFormModal } from './ClienteFormModal';

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

const EXISTENTE = { id: 'cli-7', nome: 'Somatec Blocking', cnpj: '16774052000155' };

describe('ClienteFormModal — CNPJ que já existe', () => {
  it('avisa, oferece usar o existente e NÃO consulta a Receita', async () => {
    apiGet.mockResolvedValue({ data: [EXISTENTE] });
    const usar = vi.fn();
    render(
      <ClienteFormModal
        open
        cliente={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onUsarExistente={usar}
      />,
    );

    const cnpj = screen.getByTestId('cliente-cnpj-input');
    fireEvent.change(cnpj, { target: { value: '16774052000155' } });
    fireEvent.blur(cnpj);

    await waitFor(() => expect(screen.getByTestId('cliente-cnpj-existente')).toBeTruthy());
    expect(screen.getByTestId('cliente-cnpj-existente').textContent).toContain('Somatec Blocking');
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet.mock.calls[0][0]).toBe('/clientes?search=16774052000155&limit=5');

    fireEvent.click(screen.getByTestId('cliente-usar-existente'));
    expect(usar).toHaveBeenCalledWith(EXISTENTE);
  });

  it('CNPJ novo segue pra Receita e preenche a razão social', async () => {
    apiGet
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ razaoSocial: 'EMPRESA NOVA LTDA', cidade: 'São Paulo', uf: 'SP' });
    render(<ClienteFormModal open cliente={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const cnpj = screen.getByTestId('cliente-cnpj-input');
    fireEvent.change(cnpj, { target: { value: '16774052000155' } });
    fireEvent.blur(cnpj);

    await waitFor(() =>
      expect((screen.getByTestId('cliente-nome-input') as HTMLInputElement).value).toBe(
        'EMPRESA NOVA LTDA',
      ),
    );
    expect(apiGet.mock.calls[1][0]).toBe('/clientes/cnpj/16774052000155/lookup');
    expect(screen.queryByTestId('cliente-cnpj-existente')).toBeNull();
  });
});
