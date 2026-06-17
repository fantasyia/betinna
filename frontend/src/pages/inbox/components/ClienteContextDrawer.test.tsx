import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { ClienteContextDrawer } from './ClienteContextDrawer';

afterEach(() => cleanup());

// Shared navigate spy — precisa ser definido antes dos mocks
const navigateMock = vi.fn();

// react-router-dom: mocado para jsdom (sem BrowserRouter)
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({
    data: {
      id: 'cli-1',
      nome: 'Acme Ltda',
      cnpj: '12.345.678/0001-99',
      email: 'contato@acme.com',
      telefone: '(11) 99999-0000',
      cidade: 'São Paulo',
      uf: 'SP',
      segmento: 'Atacado',
      status: 'ATIVO',
      representante: { nome: 'João Rep' },
      _count: { pedidos: 5, propostas: 3, amostras: 1 },
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    put: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  ApiError: class extends Error {},
}));

beforeEach(() => {
  navigateMock.mockReset();
});

const defaultProps = {
  clienteId: 'cli-1',
  onClose: vi.fn(),
  onCriarPedido: vi.fn(),
};

describe('ClienteContextDrawer', () => {
  it('renderiza o nome do cliente', () => {
    render(<ClienteContextDrawer {...defaultProps} />);
    const found = screen.getAllByText('Acme Ltda');
    expect(found.length).toBeGreaterThan(0);
  });

  it('renderiza o segmento do cliente', () => {
    render(<ClienteContextDrawer {...defaultProps} />);
    const el = screen.getByText('Atacado');
    expect(el).toBeTruthy();
  });

  it('renderiza o CNPJ', () => {
    render(<ClienteContextDrawer {...defaultProps} />);
    const el = screen.getByText('12.345.678/0001-99');
    expect(el).toBeTruthy();
  });

  it('renderiza o telefone', () => {
    render(<ClienteContextDrawer {...defaultProps} />);
    const el = screen.getByText('(11) 99999-0000');
    expect(el).toBeTruthy();
  });

  it('renderiza cidade/UF concatenados', () => {
    render(<ClienteContextDrawer {...defaultProps} />);
    const el = screen.getByText('São Paulo/SP');
    expect(el).toBeTruthy();
  });

  it('renderiza o nome do representante', () => {
    render(<ClienteContextDrawer {...defaultProps} />);
    const el = screen.getByText('João Rep');
    expect(el).toBeTruthy();
  });

  it('renderiza os stats (pedidos, propostas, amostras)', () => {
    render(<ClienteContextDrawer {...defaultProps} />);
    expect(screen.getByText('Pedidos')).toBeTruthy();
    expect(screen.getByText('Propostas')).toBeTruthy();
    expect(screen.getByText('Amostras')).toBeTruthy();
    // valores numéricos
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('botão "Criar pedido" chama onCriarPedido', () => {
    const onCriarPedido = vi.fn();
    render(<ClienteContextDrawer {...defaultProps} onCriarPedido={onCriarPedido} />);
    const btn = screen.getByTestId('inbox-cliente-pedido');
    fireEvent.click(btn);
    expect(onCriarPedido).toHaveBeenCalledTimes(1);
  });

  it('botão "Abrir ficha completa" chama navigate com o clienteId', () => {
    render(<ClienteContextDrawer {...defaultProps} />);
    const btn = screen.getByTestId('inbox-cliente-abrir');
    fireEvent.click(btn);
    expect(navigateMock).toHaveBeenCalledWith('/clientes/cli-1');
  });

  it('drawer renderiza (componente montado sem crash)', () => {
    render(<ClienteContextDrawer {...defaultProps} />);
    const drawer = document.querySelector('[role="dialog"]');
    expect(drawer).toBeTruthy();
  });

  it('chama onClose ao pressionar ESC', () => {
    const onClose = vi.fn();
    render(<ClienteContextDrawer {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
