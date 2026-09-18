/**
 * Treinamentos — a aba onde o funcionário assiste os vídeos internos.
 *
 * O que vale vigiar aqui:
 *  - o player usa `youtube-nocookie` (escolha de privacidade, invisível na tela);
 *  - o iframe só monta ao clicar — um por card derrubaria a página;
 *  - quem não é gestão não vê botão de cadastrar nem de apagar;
 *  - a recusa do backend (link que não é YouTube) chega ao usuário.
 */

import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const apiPost = vi.fn();
const apiDelete = vi.fn();
let papel = 'REP';
let lista: unknown = [];
let carregando = false;
let erro: string | null = null;

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useLocation: () => ({ pathname: '/treinamentos', search: '' }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => papel,
  hasPermission: () => true,
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: lista, loading: carregando, error: erro, refetch: vi.fn() }),
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: (...a: unknown[]) => apiPost(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
  },
  ApiError: class extends Error {},
  apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import TreinamentosPage from './TreinamentosPage';

const VIDEO = {
  id: 't1',
  titulo: 'Como apresentar o Master Block',
  descricao: 'Roteiro da visita',
  youtubeId: 'dQw4w9WgXcQ',
  categoria: 'Comercial',
  ordem: 1,
  ativo: true,
  urlEmbed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  urlMiniatura: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
};

afterEach(() => {
  cleanup();
  apiPost.mockReset();
  apiDelete.mockReset();
  papel = 'REP';
  lista = [];
  carregando = false;
  erro = null;
});

describe('TreinamentosPage', () => {
  it('lista os vídeos agrupados por categoria', () => {
    lista = [VIDEO, { ...VIDEO, id: 't2', titulo: 'Instalação', categoria: 'Técnico' }];
    render(<TreinamentosPage />);
    expect(screen.getByText('Comercial')).toBeTruthy();
    expect(screen.getByText('Técnico')).toBeTruthy();
  });

  /**
   * 🔴 Um iframe por card carregaria dezenas de players do YouTube de uma vez.
   * Antes do clique só existe a miniatura, que é uma imagem.
   */
  it('NÃO monta player nenhum antes do clique', () => {
    lista = [VIDEO];
    const { container } = render(<TreinamentosPage />);
    expect(screen.queryByTestId('treinamento-player')).toBeNull();
    expect(container.querySelectorAll('iframe').length).toBe(0);
    // O que existe é a miniatura, que é uma imagem servida pelo YouTube.
    // (`alt=""` de propósito: o nome acessível está no botão que a envolve.)
    const capa = container.querySelector('img');
    expect(capa?.getAttribute('src')).toContain('i.ytimg.com');
  });

  it('abre o player no domínio sem cookie ao clicar', async () => {
    lista = [VIDEO];
    render(<TreinamentosPage />);

    fireEvent.click(screen.getByTestId('treinamento-abrir-t1'));

    await waitFor(() => expect(screen.getByTestId('treinamento-player')).toBeTruthy());
    const src = screen.getByTestId('treinamento-player').getAttribute('src');
    // Decisão de privacidade: o domínio normal planta cookie de rastreio em todo
    // funcionário que abre a aba.
    expect(src).toContain('youtube-nocookie.com');
    expect(src).toContain('dQw4w9WgXcQ');
  });

  it('funcionário não vê botão de cadastrar nem de apagar', () => {
    papel = 'REP';
    lista = [VIDEO];
    render(<TreinamentosPage />);
    expect(screen.queryByTestId('treinamento-novo')).toBeNull();
    expect(screen.queryByLabelText(/Apagar/)).toBeNull();
  });

  it('gestão vê os dois', () => {
    papel = 'DIRECTOR';
    lista = [VIDEO];
    render(<TreinamentosPage />);
    expect(screen.getByTestId('treinamento-novo')).toBeTruthy();
    expect(screen.getByLabelText(`Apagar ${VIDEO.titulo}`)).toBeTruthy();
  });

  it('marca o que está fora do ar', () => {
    papel = 'DIRECTOR';
    lista = [{ ...VIDEO, ativo: false }];
    render(<TreinamentosPage />);
    expect(screen.getByText('fora do ar')).toBeTruthy();
  });

  it('manda o link cru pro backend — quem normaliza é ele', async () => {
    papel = 'DIRECTOR';
    apiPost.mockResolvedValue({ id: 'novo' });
    render(<TreinamentosPage />);

    fireEvent.click(screen.getByTestId('treinamento-novo'));
    fireEvent.change(screen.getByTestId('treinamento-titulo'), { target: { value: 'Aula 1' } });
    fireEvent.change(screen.getByTestId('treinamento-video'), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ?t=10' },
    });
    fireEvent.click(screen.getByTestId('treinamento-salvar'));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const corpo = apiPost.mock.calls[0][1] as Record<string, unknown>;
    // A tela não tenta extrair o ID: duplicar essa regra criaria duas verdades
    // sobre o que é um link válido.
    expect(corpo.video).toBe('https://youtu.be/dQw4w9WgXcQ?t=10');
    expect(corpo.titulo).toBe('Aula 1');
  });

  /** ⛔ A recusa do backend é a que explica o que colar — tem que chegar ao usuário. */
  it('mostra a recusa do backend quando o link não é do YouTube', async () => {
    papel = 'DIRECTOR';
    apiPost.mockRejectedValue(new Error('Não reconheci um vídeo do YouTube nesse link.'));
    render(<TreinamentosPage />);

    fireEvent.click(screen.getByTestId('treinamento-novo'));
    fireEvent.change(screen.getByTestId('treinamento-titulo'), { target: { value: 'Aula' } });
    fireEvent.change(screen.getByTestId('treinamento-video'), {
      target: { value: 'https://vimeo.com/123' },
    });
    fireEvent.click(screen.getByTestId('treinamento-salvar'));

    await waitFor(() => expect(screen.getByTestId('treinamento-erro')).toBeTruthy());
    expect(screen.getByTestId('treinamento-erro').textContent).toContain('YouTube');
  });

  it('não chama a API sem título ou sem link', () => {
    papel = 'DIRECTOR';
    render(<TreinamentosPage />);
    fireEvent.click(screen.getByTestId('treinamento-novo'));
    fireEvent.click(screen.getByTestId('treinamento-salvar'));
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.getByTestId('treinamento-erro').textContent).toContain('obrigatórios');
  });
});
