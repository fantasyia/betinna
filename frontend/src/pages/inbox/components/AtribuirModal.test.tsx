import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { AtribuirModal } from './AtribuirModal';

afterEach(() => cleanup());

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({
    data: {
      data: [
        { id: 'u1', nome: 'Alice', role: 'ATENDENTE' },
        { id: 'u2', nome: 'Bob', role: 'ADMIN' },
      ],
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

const defaultProps = {
  conversaId: 'conv-123',
  atribuidoAtual: null,
  onClose: vi.fn(),
  onDone: vi.fn(),
};

describe('AtribuirModal', () => {
  it('renderiza os usuários retornados pelo useApiQuery', () => {
    render(<AtribuirModal {...defaultProps} />);
    const aliceBtn = screen.getByTestId('atribuir-user-u1');
    const bobBtn = screen.getByTestId('atribuir-user-u2');
    expect(aliceBtn).toBeTruthy();
    expect(bobBtn).toBeTruthy();
  });

  it('exibe o nome dos usuários no botão', () => {
    render(<AtribuirModal {...defaultProps} />);
    const aliceBtn = screen.getByTestId('atribuir-user-u1');
    expect(aliceBtn.textContent).toBeTruthy();
    // nome está no botão
    const found = aliceBtn.textContent?.includes('Alice');
    expect(found).toBe(true);
  });

  it('NÃO exibe botão "Remover atribuição" quando atribuidoAtual é null', () => {
    render(<AtribuirModal {...defaultProps} />);
    const removeBtn = screen.queryByTestId('atribuir-ninguem');
    expect(removeBtn).toBeNull();
  });

  it('exibe botão "Remover atribuição" quando atribuidoAtual está preenchido', () => {
    render(
      <AtribuirModal
        {...defaultProps}
        atribuidoAtual={{ id: 'u1', nome: 'Alice' }}
      />,
    );
    const removeBtn = screen.getByTestId('atribuir-ninguem');
    expect(removeBtn).toBeTruthy();
  });

  it('clica em usuário e chama api.patch com endpoint e payload corretos', async () => {
    const { api } = await import('@/lib/api');
    render(<AtribuirModal {...defaultProps} />);
    const bobBtn = screen.getByTestId('atribuir-user-u2');
    fireEvent.click(bobBtn);
    await Promise.resolve();
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/inbox/conv-123/atribuir', {
      atribuidoId: 'u2',
    });
  });

  it('clica em "Remover atribuição" e chama api.patch com atribuidoId null', async () => {
    const { api } = await import('@/lib/api');
    render(
      <AtribuirModal
        {...defaultProps}
        atribuidoAtual={{ id: 'u1', nome: 'Alice' }}
      />,
    );
    const removeBtn = screen.getByTestId('atribuir-ninguem');
    fireEvent.click(removeBtn);
    await Promise.resolve();
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/inbox/conv-123/atribuir', {
      atribuidoId: null,
    });
  });

  it('chama onDone após patch bem-sucedido', async () => {
    const onDone = vi.fn();
    render(<AtribuirModal {...defaultProps} onDone={onDone} />);
    const aliceBtn = screen.getByTestId('atribuir-user-u1');
    fireEvent.click(aliceBtn);
    await Promise.resolve();
    await Promise.resolve();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('filtra usuários pelo campo de busca', () => {
    render(<AtribuirModal {...defaultProps} />);
    const input = screen.getByPlaceholderText('Buscar usuário…');
    fireEvent.change(input, { target: { value: 'alice' } });
    expect(screen.getByTestId('atribuir-user-u1')).toBeTruthy();
    expect(screen.queryByTestId('atribuir-user-u2')).toBeNull();
  });

  it('mostra mensagem quando nenhum usuário bate com a busca', () => {
    render(<AtribuirModal {...defaultProps} />);
    const input = screen.getByPlaceholderText('Buscar usuário…');
    fireEvent.change(input, { target: { value: 'zzz-nao-existe' } });
    const msg = screen.getByText('Nenhum usuário encontrado.');
    expect(msg).toBeTruthy();
  });

  it('chama onClose ao pressionar ESC', () => {
    const onClose = vi.fn();
    render(<AtribuirModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('usuário atual aparece desabilitado', () => {
    render(
      <AtribuirModal
        {...defaultProps}
        atribuidoAtual={{ id: 'u1', nome: 'Alice' }}
      />,
    );
    const aliceBtn = screen.getByTestId('atribuir-user-u1') as HTMLButtonElement;
    expect(aliceBtn.disabled).toBe(true);
  });
});
