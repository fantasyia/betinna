/**
 * Item 3a (29/09): conta com várias Páginas — o admin escolhe qual conectar.
 */
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

const post = vi.fn();
let pendentes: Array<{ id: string; name: string }> = [];

vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
  apiErrorMessage: (e: Error) => e.message,
}));
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: pendentes, loading: false, error: null, refetch: vi.fn() }),
}));

import { EscolherPaginaMeta } from './MetaPaginaCards';

afterEach(() => {
  cleanup();
  post.mockReset();
  pendentes = [];
});

describe('EscolherPaginaMeta', () => {
  it('sem pendência não mostra nada', () => {
    const { container } = render(<EscolherPaginaMeta onConectada={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('lista as Páginas e conecta a ESCOLHIDA', async () => {
    pendentes = [
      { id: 'page-a', name: 'Loja A' },
      { id: 'page-b', name: 'Loja B' },
    ];
    post.mockResolvedValue({});
    const onConectada = vi.fn();
    const { getByTestId } = render(<EscolherPaginaMeta onConectada={onConectada} />);
    fireEvent.click(getByTestId('meta-pagina-page-b'));
    await waitFor(() => expect(onConectada).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/integracoes/meta/escolher-pagina', { pageId: 'page-b' });
  });
});
