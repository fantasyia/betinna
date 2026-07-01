import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * Contrato do WebhookTriggerConfig — gatilho "Webhook recebido".
 * Agora recebe data/onUpdate: além do CRUD de webhooks (lista via
 * useApiQuery('/orquestracao/webhooks') + URL `<apiBase>/webhooks/fluxo/<token>`),
 * grava no config do nó qual webhook dispara (webhookId) e o filtro de payload.
 *
 * Mocks inline de useApiQuery/useToast/api (sem helper compartilhado, pra não
 * colidir com outros agentes rodando em paralelo).
 */

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

const apiPost = vi.fn(() =>
  Promise.resolve({ id: 'new', nome: 'Novo gancho', token: 'tok_new', secret: 'sek_123' }),
);
const apiDelete = vi.fn(() => Promise.resolve({}));
vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => apiPost(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  ApiError: class ApiError extends Error {},
}));

import { WebhookTriggerConfig } from './WebhookTriggerConfig';

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return { titulo: 'Webhook', tipo: 'TRIGGER', triggerTipo: 'WEBHOOK_RECEBIDO', config };
}
function makeOnUpdate(data: NodePayload) {
  let last: NodePayload | null = null;
  const onUpdate = vi.fn((updater: (d: NodePayload) => NodePayload) => {
    last = updater(data);
  });
  return { onUpdate, getLast: () => last as NodePayload };
}
function renderCfg(config: Record<string, unknown> = {}) {
  const data = makeData(config);
  const { onUpdate, getLast } = makeOnUpdate(data);
  render(<WebhookTriggerConfig data={data} onUpdate={onUpdate} />);
  return { onUpdate, getLast };
}

describe('WebhookTriggerConfig', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('round-trip de leitura: um card por webhook com nome e URL do token', () => {
    renderCfg();
    // nome aparece no card (span) — e também como <option> no dropdown; restringe ao card.
    expect(screen.getByText('Pedido pago', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('Carrinho abandonado', { selector: 'span' })).toBeTruthy();
    const url1 = screen.getByText((t) => t.includes('/webhooks/fluxo/tok_abc'));
    expect(url1.textContent?.endsWith('/webhooks/fluxo/tok_abc')).toBe(true);
    expect(screen.getByText((t) => t.includes('/webhooks/fluxo/tok_xyz'))).toBeTruthy();
    expect(screen.getAllByText('copiar')).toHaveLength(2);
    expect(screen.getAllByText('remover')).toHaveLength(2);
  });

  it('copiar: escreve a URL no clipboard e dispara toast.success', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCfg();
    fireEvent.click(screen.getAllByText('copiar')[0]);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect((writeText.mock.calls[0][0] as string).endsWith('/webhooks/fluxo/tok_abc')).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith('URL copiada');
  });

  it('criar: nome (trim) → api.post + revela o secret uma vez', async () => {
    renderCfg();
    const input = screen.getByPlaceholderText('Nome do webhook') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Novo gancho  ' } });
    fireEvent.click(screen.getByText('Criar'));
    expect(apiPost).toHaveBeenCalledWith('/orquestracao/webhooks', { nome: 'Novo gancho' });
    await Promise.resolve();
    await Promise.resolve();
    expect(refetch).toHaveBeenCalled();
    // secret revelado
    expect(screen.getByText('sek_123')).toBeTruthy();
  });

  it('criar: nome vazio NÃO chama api.post', () => {
    renderCfg();
    const input = screen.getByPlaceholderText('Nome do webhook') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Criar'));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('rotacionar: chama o endpoint de rotação e revela o novo secret', async () => {
    renderCfg();
    fireEvent.click(screen.getAllByText('rotacionar secret')[0]);
    expect(apiPost).toHaveBeenCalledWith('/orquestracao/webhooks/wh1/rotacionar-secret');
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByText('sek_123')).toBeTruthy();
  });

  it('remover: api.delete com o id + refetch', async () => {
    renderCfg();
    fireEvent.click(screen.getAllByText('remover')[1]);
    expect(apiDelete).toHaveBeenCalledWith('/orquestracao/webhooks/wh2');
    await Promise.resolve();
    await Promise.resolve();
    expect(refetch).toHaveBeenCalled();
  });

  it('config do nó: escolher webhook grava config.webhookId', () => {
    const { getLast } = renderCfg();
    const combos = screen.getAllByRole('combobox') as HTMLSelectElement[];
    // [0] = "Disparar por qual webhook"; [1] = operador do filtro.
    fireEvent.change(combos[0], { target: { value: 'wh1' } });
    expect(getLast().config.webhookId).toBe('wh1');
  });

  it('config do nó: filtro de payload grava caminho/operador/valor', () => {
    const { getLast } = renderCfg();
    const caminho = screen.getByPlaceholderText('campo (ex: evento)') as HTMLInputElement;
    fireEvent.change(caminho, { target: { value: 'evento' } });
    expect(getLast().config.filtroPayload).toMatchObject({
      caminho: 'evento',
      operador: 'eq',
      valor: '',
    });
  });
});
