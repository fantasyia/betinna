import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { NotasInternasDrawer } from './NotasInternasDrawer';

afterEach(() => cleanup());

// Sessão mocada — usuário normal (meuId = 'user-me')
vi.mock('@/lib/auth-store', () => ({
  getSession: () => ({
    user: { id: 'user-me', role: 'ATENDENTE' },
  }),
}));

const mockRefetch = vi.fn();

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({
    data: [
      {
        id: 'nota-1',
        conversationId: 'conv-abc',
        usuarioId: 'user-me',
        texto: 'Nota do próprio usuário',
        criadoEm: '2026-06-16T10:00:00.000Z',
        atualizadoEm: '2026-06-16T10:00:00.000Z',
        usuario: { id: 'user-me', nome: 'Eu Mesmo' },
      },
      {
        id: 'nota-2',
        conversationId: 'conv-abc',
        usuarioId: 'user-outro',
        texto: 'Nota de outro usuário',
        criadoEm: '2026-06-16T09:00:00.000Z',
        atualizadoEm: '2026-06-16T09:00:00.000Z',
        usuario: { id: 'user-outro', nome: 'Outro Usuário' },
      },
    ],
    loading: false,
    error: null,
    refetch: mockRefetch,
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
  ApiError: class extends Error {
    status?: number;
  },
}));

const defaultProps = {
  conversaId: 'conv-abc',
  onClose: vi.fn(),
};

describe('NotasInternasDrawer', () => {
  it('renderiza as notas existentes', () => {
    render(<NotasInternasDrawer {...defaultProps} />);
    expect(screen.getByTestId('inbox-nota-nota-1')).toBeTruthy();
    expect(screen.getByTestId('inbox-nota-nota-2')).toBeTruthy();
  });

  it('exibe o texto das notas', () => {
    render(<NotasInternasDrawer {...defaultProps} />);
    const nota1 = screen.getByTestId('inbox-nota-nota-1');
    expect(nota1.textContent?.includes('Nota do próprio usuário')).toBe(true);
    const nota2 = screen.getByTestId('inbox-nota-nota-2');
    expect(nota2.textContent?.includes('Nota de outro usuário')).toBe(true);
  });

  it('exibe botões editar/excluir apenas para a própria nota', () => {
    render(<NotasInternasDrawer {...defaultProps} />);
    // própria nota: tem os botões
    expect(screen.getByTestId('inbox-nota-editar-nota-1')).toBeTruthy();
    expect(screen.getByTestId('inbox-nota-excluir-nota-1')).toBeTruthy();
    // nota de outro: não tem
    expect(screen.queryByTestId('inbox-nota-editar-nota-2')).toBeNull();
    expect(screen.queryByTestId('inbox-nota-excluir-nota-2')).toBeNull();
  });

  it('botão Adicionar nota fica desabilitado quando o textarea está vazio', () => {
    render(<NotasInternasDrawer {...defaultProps} />);
    const addBtn = screen.getByTestId('inbox-nota-add-btn') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it('digitar no textarea habilita o botão Adicionar nota', () => {
    render(<NotasInternasDrawer {...defaultProps} />);
    const textarea = screen.getByTestId('inbox-nota-input');
    fireEvent.change(textarea, { target: { value: 'Nova anotação' } });
    const addBtn = screen.getByTestId('inbox-nota-add-btn') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);
  });

  it('clicar em Adicionar nota chama api.post com o texto correto', async () => {
    const { api } = await import('@/lib/api');
    render(<NotasInternasDrawer {...defaultProps} />);
    const textarea = screen.getByTestId('inbox-nota-input');
    fireEvent.change(textarea, { target: { value: 'Nova anotação' } });
    const addBtn = screen.getByTestId('inbox-nota-add-btn');
    fireEvent.click(addBtn);
    await Promise.resolve();
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/inbox/conv-abc/notas', {
      texto: 'Nova anotação',
    });
  });

  it('após adicionar chama refetch', async () => {
    render(<NotasInternasDrawer {...defaultProps} />);
    const textarea = screen.getByTestId('inbox-nota-input');
    fireEvent.change(textarea, { target: { value: 'Nova anotação' } });
    const addBtn = screen.getByTestId('inbox-nota-add-btn');
    fireEvent.click(addBtn);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('clicar em Excluir chama api.delete com o id correto', async () => {
    const { api } = await import('@/lib/api');
    render(<NotasInternasDrawer {...defaultProps} />);
    const excluirBtn = screen.getByTestId('inbox-nota-excluir-nota-1');
    fireEvent.click(excluirBtn);
    await Promise.resolve();
    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/inbox/conv-abc/notas/nota-1');
  });

  it('clicar em Editar abre o textarea de edição preenchido com o texto da nota', () => {
    render(<NotasInternasDrawer {...defaultProps} />);
    const editarBtn = screen.getByTestId('inbox-nota-editar-nota-1');
    fireEvent.click(editarBtn);
    const editInput = screen.getByTestId(
      'inbox-nota-edit-input-nota-1',
    ) as HTMLTextAreaElement;
    expect(editInput).toBeTruthy();
    expect(editInput.value).toBe('Nota do próprio usuário');
  });

  it('salvar edição chama api.patch com o texto atualizado', async () => {
    const { api } = await import('@/lib/api');
    render(<NotasInternasDrawer {...defaultProps} />);
    fireEvent.click(screen.getByTestId('inbox-nota-editar-nota-1'));
    const editInput = screen.getByTestId('inbox-nota-edit-input-nota-1');
    fireEvent.change(editInput, { target: { value: 'Texto editado' } });
    const saveBtn = screen.getByTestId('inbox-nota-edit-save-nota-1');
    fireEvent.click(saveBtn);
    await Promise.resolve();
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      '/inbox/conv-abc/notas/nota-1',
      { texto: 'Texto editado' },
    );
  });

  it('cancelar edição esconde o textarea de edição', () => {
    render(<NotasInternasDrawer {...defaultProps} />);
    fireEvent.click(screen.getByTestId('inbox-nota-editar-nota-1'));
    expect(screen.getByTestId('inbox-nota-edit-input-nota-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('inbox-nota-edit-cancel-nota-1'));
    expect(screen.queryByTestId('inbox-nota-edit-input-nota-1')).toBeNull();
  });

  it('chama onClose ao pressionar ESC', () => {
    const onClose = vi.fn();
    render(<NotasInternasDrawer {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
