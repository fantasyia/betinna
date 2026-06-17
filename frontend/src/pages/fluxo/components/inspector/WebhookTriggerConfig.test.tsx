import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * Contrato do WebhookTriggerConfig — gatilho "Webhook recebido". Form AUTOCONTIDO
 * (sem props/onUpdate): lê a lista de webhooks via useApiQuery('/orquestracao/webhooks')
 * e monta a URL pública `<apiBase>/webhooks/fluxo/<token>`. Cria/remove via api.post/delete.
 *
 * Estes testes travam o contrato de RENDER + AÇÕES:
 *  - renderiza um card por webhook com nome + URL derivada do token;
 *  - o botão "copiar" copia a URL (navigator.clipboard) e chama toast.success;
 *  - "Criar" chama api.post('/orquestracao/webhooks', { nome }) e refetch;
 *  - "remover" chama api.delete('/orquestracao/webhooks/<id>') e refetch.
 *
 * Como o form é autocontido, useApiQuery/useToast/api são mockados inline (sem
 * helper compartilhado, pra não colidir com outros agentes rodando em paralelo).
 */

// Lista representativa de webhooks devolvida pelo endpoint /orquestracao/webhooks.
const webhooks = [
  { id: 'wh1', nome: 'Pedido pago', token: 'tok_abc' },
  { id: 'wh2', nome: 'Carrinho abandonado', token: 'tok_xyz' },
];

const refetch = vi.fn();
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: webhooks, loading: false, error: null, refetch }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@/components/toast', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
    push: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// api.post/delete não devem tocar a rede de verdade; ApiError é usado no catch.
const apiPost = vi.fn(() => Promise.resolve({}));
const apiDelete = vi.fn(() => Promise.resolve({}));
vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => apiPost(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  ApiError: class ApiError extends Error {},
}));

// Import DEPOIS dos mocks (vi.mock é hoisted, mas mantém claro o que é mockado).
import { WebhookTriggerConfig } from './WebhookTriggerConfig';

describe('WebhookTriggerConfig', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('round-trip de leitura: renderiza um card por webhook com nome e URL do token', () => {
    render(<WebhookTriggerConfig />);

    // nome de cada webhook aparece
    expect(screen.getByText('Pedido pago')).toBeTruthy();
    expect(screen.getByText('Carrinho abandonado')).toBeTruthy();

    // a URL pública é derivada do token: termina em /webhooks/fluxo/<token>.
    // (a base muda conforme VITE_API_URL; o sufixo é o contrato estável.)
    const url1 = screen.getByText((t) => t.includes('/webhooks/fluxo/tok_abc'));
    expect(url1.textContent?.endsWith('/webhooks/fluxo/tok_abc')).toBe(true);
    expect(screen.getByText((t) => t.includes('/webhooks/fluxo/tok_xyz'))).toBeTruthy();

    // um botão "copiar" e um "remover" por card
    expect(screen.getAllByText('copiar')).toHaveLength(2);
    expect(screen.getAllByText('remover')).toHaveLength(2);
  });

  it('copiar: escreve a URL no clipboard e dispara toast.success', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<WebhookTriggerConfig />);

    fireEvent.click(screen.getAllByText('copiar')[0]);

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedUrl = writeText.mock.calls[0][0] as string;
    expect(copiedUrl.endsWith('/webhooks/fluxo/tok_abc')).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith('URL copiada');
  });

  it('criar: digitar nome + clicar "Criar" chama api.post com o nome (trim) e refetch', async () => {
    render(<WebhookTriggerConfig />);

    const input = screen.getByPlaceholderText('Nome do webhook') as HTMLInputElement;
    // espaços nas pontas pra travar o trim()
    fireEvent.change(input, { target: { value: '  Novo gancho  ' } });
    expect(input.value).toBe('  Novo gancho  ');

    fireEvent.click(screen.getByText('Criar'));

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith('/orquestracao/webhooks', { nome: 'Novo gancho' });

    // refetch acontece depois do await do post resolver
    await Promise.resolve();
    await Promise.resolve();
    expect(refetch).toHaveBeenCalled();
  });

  it('criar: nome vazio NÃO chama api.post (guarda do !nome.trim())', () => {
    render(<WebhookTriggerConfig />);

    const input = screen.getByPlaceholderText('Nome do webhook') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Criar'));

    expect(apiPost).not.toHaveBeenCalled();
  });

  it('remover: clicar "remover" chama api.delete com o id do webhook e refetch', async () => {
    render(<WebhookTriggerConfig />);

    fireEvent.click(screen.getAllByText('remover')[1]);

    expect(apiDelete).toHaveBeenCalledTimes(1);
    expect(apiDelete).toHaveBeenCalledWith('/orquestracao/webhooks/wh2');

    await Promise.resolve();
    await Promise.resolve();
    expect(refetch).toHaveBeenCalled();
  });
});
