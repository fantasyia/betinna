/**
 * DuplicatasModal + VincularClienteDialog — comportamento do fluxo de mesclagem.
 *
 * Foco no que não pode quebrar:
 *  - listar os grupos e disparar a PRÉVIA com o par certo (quem fica × quem é absorvido)
 *  - confirmar chama POST /contatos/mesclar
 *  - vincular chama POST /contatos/vincular-cliente (nunca /mesclar — não funde)
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: (v: string) => v }));

const toastSuccess = vi.fn();
vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const GRUPOS = [
  {
    chave: '99990001',
    motivo: 'telefone',
    leads: [
      {
        id: 'lead-velho',
        nome: 'ACME (site)',
        contatoTelefone: '11999990001',
        contatoEmail: null,
        criadoEm: '2026-01-01',
        utmCampaign: 'vtcd-alimenticia',
        maisAntigo: true,
      },
      {
        id: 'lead-novo',
        nome: 'Acme Ltda',
        contatoTelefone: '11999990001',
        contatoEmail: null,
        criadoEm: '2026-06-01',
        utmCampaign: null,
        maisAntigo: false,
      },
    ],
  },
];

const GRUPOS_CLIENTE = [
  {
    chave: '11222333000144',
    motivo: 'cnpj',
    clientes: [
      { id: 'cli-velho', nome: 'ACME LTDA', cnpj: '11.222.333/0001-44', telefone: '1130001122', email: null, criadoEm: '2026-01-01', maisAntigo: true },
      { id: 'cli-novo', nome: 'Acme', cnpj: '11222333000144', telefone: null, email: null, criadoEm: '2026-06-01', maisAntigo: false },
    ],
  },
];

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path?.startsWith('/contatos/clientes/duplicatas'))
      return { data: GRUPOS_CLIENTE, loading: false, error: null, refetch: vi.fn() };
    if (path?.startsWith('/contatos/duplicatas'))
      return { data: GRUPOS, loading: false, error: null, refetch: vi.fn() };
    if (path?.startsWith('/clientes'))
      return {
        data: {
          data: [{ id: 'cli-1', nome: 'Cliente Alpha', telefone: '11988887777', cidade: 'SP' }],
          pagination: { page: 1, limit: 8, total: 1, totalPages: 1 },
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  },
}));

const post = vi.fn((path: string) => {
  if (path === '/contatos/mesclar/previa')
    return Promise.resolve({
      principal: { id: 'lead-novo', nome: 'Acme Ltda' },
      absorvido: { id: 'lead-velho', nome: 'ACME (site)' },
      atribuicaoFinal: { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'vtcd-alimenticia', origemCadastro: 'site' },
      atribuicaoMudou: true,
      camposPreenchidos: [{ campo: 'contatoEmail', valor: 'contato@acme.com' }],
      vinculosMigrados: { tags: 2, historicoEtapas: 3, conversas: 1, formularios: 0 },
    });
  if (path === '/contatos/clientes/mesclar/previa')
    return Promise.resolve({
      principal: { id: 'cli-novo', nome: 'Acme', cnpj: '11222333000144' },
      absorvido: { id: 'cli-velho', nome: 'ACME LTDA', cnpj: '11.222.333/0001-44' },
      migra: { pedidos: 3, propostas: 1, amostras: 0 },
      conflitosPreco: 1,
      pontosFidelidadeSomados: 50,
    });
  return Promise.resolve({ mesclagemId: 'msc-1' });
});
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => post(...(a as [string])), get: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}));

import { DuplicatasModal } from './DuplicatasModal';
import { VincularClienteDialog } from './VincularClienteDialog';

afterEach(cleanup);
beforeEach(() => {
  post.mockClear();
  toastSuccess.mockClear();
});

describe('DuplicatasModal', () => {
  it('lista o grupo e mostra a campanha do lead mais antigo', () => {
    render(<DuplicatasModal onClose={vi.fn()} onMerged={vi.fn()} />);
    expect(screen.getByText('ACME (site)')).toBeTruthy();
    expect(screen.getByText('mais antigo')).toBeTruthy();
    expect(screen.getByText(/vtcd-alimenticia/)).toBeTruthy();
  });

  it('escolher "manter Acme Ltda" abre a prévia com o par certo e confirma a mesclagem', async () => {
    render(<DuplicatasModal onClose={vi.fn()} onMerged={vi.fn()} />);

    // Botão que mantém o 2º lead (o novo) e absorve o velho.
    fireEvent.click(screen.getByText(/Manter "Acme Ltda"/));

    // A prévia foi pedida com principal = lead-novo, absorvido = lead-velho.
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/contatos/mesclar/previa', {
        principalId: 'lead-novo',
        absorvidoId: 'lead-velho',
      }),
    );
    // A campanha que sobrevive aparece na prévia.
    await waitFor(() => expect(screen.getByText('herdada do absorvido')).toBeTruthy());

    fireEvent.click(screen.getByTestId('confirmar-mesclagem'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/contatos/mesclar', {
        principalId: 'lead-novo',
        absorvidoId: 'lead-velho',
      }),
    );
  });
});

describe('DuplicatasModal — aba de clientes', () => {
  it('podeCliente mostra a aba Clientes e mescla via /contatos/clientes/mesclar', async () => {
    render(<DuplicatasModal onClose={vi.fn()} onMerged={vi.fn()} podeCliente />);

    fireEvent.click(screen.getByText('Clientes'));
    expect(screen.getByText('ACME LTDA')).toBeTruthy();

    fireEvent.click(screen.getByText(/Manter "Acme"/));
    // Prévia de cliente pedida com o par certo.
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/contatos/clientes/mesclar/previa', {
        principalId: 'cli-novo',
        absorvidoId: 'cli-velho',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('confirmar-mesclagem-cliente')).toBeTruthy());

    fireEvent.click(screen.getByTestId('confirmar-mesclagem-cliente'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/contatos/clientes/mesclar', {
        principalId: 'cli-novo',
        absorvidoId: 'cli-velho',
      }),
    );
  });

  it('sem podeCliente, a aba Clientes não aparece', () => {
    render(<DuplicatasModal onClose={vi.fn()} onMerged={vi.fn()} />);
    expect(screen.queryByText('Clientes')).toBeNull();
  });
});

describe('VincularClienteDialog', () => {
  it('vincular chama /contatos/vincular-cliente (NÃO funde)', async () => {
    render(<VincularClienteDialog leadId="lead-1" onClose={vi.fn()} onDone={vi.fn()} />);

    fireEvent.click(screen.getByTestId('vincular-btn'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/contatos/vincular-cliente', {
        leadId: 'lead-1',
        clienteId: 'cli-1',
      }),
    );
    // Nunca chama mesclar: vínculo não apaga nada.
    expect(post).not.toHaveBeenCalledWith('/contatos/mesclar', expect.anything());
  });
});
