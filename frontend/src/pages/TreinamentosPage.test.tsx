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
  fonte: 'YOUTUBE' as const,
  youtubeId: 'dQw4w9WgXcQ',
  arquivoTamanho: null,
  categoria: 'Comercial',
  ordem: 1,
  ativo: true,
  urlEmbed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  urlMiniatura: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
  urlArquivo: null,
};

/** A segunda fonte: hospedado por nós, servido por link assinado que expira. */
const INTERNO = {
  ...VIDEO,
  id: 't2',
  titulo: 'Margem por faixa',
  fonte: 'ARQUIVO' as const,
  youtubeId: null,
  urlEmbed: null,
  urlMiniatura: null,
  urlArquivo: 'https://storage.supabase/assinada/emp-1/aula.mp4?token=abc',
  arquivoTamanho: 42_000_000,
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
    expect(screen.getByTestId('treinamento-erro').textContent).toContain('título');
  });
});

/**
 * A SEGUNDA FONTE (Léo, 18/09): vídeo hospedado por nós.
 *
 * O YouTube continua padrão porque a banda é deles. O arquivo interno existe
 * para o conteúdo que não pode circular — e a diferença que importa na tela é
 * que ele NÃO é um embed do YouTube.
 */
describe('TreinamentosPage — arquivo interno', () => {
  it('usa <video> com o link assinado, não iframe', async () => {
    lista = [INTERNO];
    render(<TreinamentosPage />);

    fireEvent.click(screen.getByTestId('treinamento-abrir-t2'));

    await waitFor(() => expect(screen.getByTestId('treinamento-player-arquivo')).toBeTruthy());
    // 🔴 Nada de YouTube aqui: se caísse no iframe, o vídeo que deveria exigir
    // login estaria sendo pedido a um servidor de terceiro.
    expect(screen.queryByTestId('treinamento-player')).toBeNull();
    expect(screen.getByTestId('treinamento-player-arquivo').getAttribute('src')).toContain(
      'assinada',
    );
  });

  it('marca na lista o que é interno', () => {
    lista = [INTERNO];
    render(<TreinamentosPage />);
    // Quem cadastra precisa ver de relance o que está exposto por link e o que não.
    expect(screen.getByText('interno')).toBeTruthy();
  });

  it('as duas fontes convivem', () => {
    lista = [VIDEO, INTERNO];
    render(<TreinamentosPage />);
    expect(screen.getByTestId('treinamento-abrir-t1')).toBeTruthy();
    expect(screen.getByTestId('treinamento-abrir-t2')).toBeTruthy();
  });

  it('avisa quando o link assinado falhou, em vez de mostrar tela preta', async () => {
    lista = [{ ...INTERNO, urlArquivo: null }];
    render(<TreinamentosPage />);

    fireEvent.click(screen.getByTestId('treinamento-abrir-t2'));

    await waitFor(() => expect(screen.getByTestId('treinamento-indisponivel')).toBeTruthy());
  });

  /**
   * 🔴 O arquivo vai DIRETO pro Storage. Se passasse pelo backend, 500 MB
   * dariam timeout e não poderiam ser retomados.
   */
  it('pede URL assinada e envia o arquivo direto, sem passar pela nossa API', async () => {
    papel = 'DIRECTOR';
    apiPost
      .mockResolvedValueOnce({ caminho: 'emp-1/123_aula.mp4', url: 'https://storage/upload?tok=1' })
      .mockResolvedValueOnce({ id: 'novo' });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<TreinamentosPage />);
    fireEvent.click(screen.getByTestId('treinamento-novo'));
    fireEvent.click(screen.getByTestId('fonte-arquivo'));
    fireEvent.change(screen.getByTestId('treinamento-titulo'), { target: { value: 'Margem' } });

    const arquivo = new File(['x'], 'aula.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByTestId('treinamento-arquivo'), { target: { files: [arquivo] } });

    fireEvent.click(screen.getByTestId('treinamento-salvar'));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost.mock.calls[0][0]).toBe('/treinamentos/upload-url');
    // O PUT do arquivo vai pro Storage, não pra nós.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage/upload?tok=1',
      expect.objectContaining({ method: 'PUT' }),
    );
    // E o cadastro manda o CAMINHO, não o arquivo.
    const corpo = apiPost.mock.calls[1][1] as Record<string, unknown>;
    expect(corpo.arquivoPath).toBe('emp-1/123_aula.mp4');
    expect(corpo.video).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('não cadastra nada se o envio do arquivo falhar', async () => {
    papel = 'DIRECTOR';
    apiPost.mockResolvedValueOnce({ caminho: 'emp-1/a.mp4', url: 'https://storage/upload' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 413 })));

    render(<TreinamentosPage />);
    fireEvent.click(screen.getByTestId('treinamento-novo'));
    fireEvent.click(screen.getByTestId('fonte-arquivo'));
    fireEvent.change(screen.getByTestId('treinamento-titulo'), { target: { value: 'Margem' } });
    fireEvent.change(screen.getByTestId('treinamento-arquivo'), {
      target: { files: [new File(['x'], 'a.mp4', { type: 'video/mp4' })] },
    });
    fireEvent.click(screen.getByTestId('treinamento-salvar'));

    await waitFor(() => expect(screen.getByTestId('treinamento-erro')).toBeTruthy());
    // Um treinamento cadastrado apontando pra um arquivo que não subiu seria um
    // card que abre em erro pro funcionário.
    expect(apiPost).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('recusa arquivo acima do teto antes de subir nada', async () => {
    papel = 'DIRECTOR';
    render(<TreinamentosPage />);
    fireEvent.click(screen.getByTestId('treinamento-novo'));
    fireEvent.click(screen.getByTestId('fonte-arquivo'));
    fireEvent.change(screen.getByTestId('treinamento-titulo'), { target: { value: 'Grande' } });

    const enorme = new File(['x'], 'enorme.mp4', { type: 'video/mp4' });
    Object.defineProperty(enorme, 'size', { value: 600 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('treinamento-arquivo'), { target: { files: [enorme] } });

    fireEvent.click(screen.getByTestId('treinamento-salvar'));

    // Barrar aqui evita 600 MB de upload que terminariam em recusa.
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.getByTestId('treinamento-erro').textContent).toContain('limite');
  });
});
