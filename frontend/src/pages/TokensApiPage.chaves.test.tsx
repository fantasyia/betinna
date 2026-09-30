/**
 * Chaves do site (leads `blc_` e pedidos `bpk_`) saíram de Integrações pra
 * Tokens de API em 30/09 — pedido do Léo: tudo que é token num lugar só.
 *
 * O cuidado: a aba Tokens é liberada pelo módulo `quadros`, que o REP também
 * tem; as rotas das chaves são ADMIN/DIRECTOR no backend. Mostrar os cards pra
 * todo mundo que abre a página daria dois cards em 403 pro rep.
 */
import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';

let papel = 'DIRECTOR';
vi.mock('@/hooks/usePermission', () => ({ useRole: () => papel }));
const TOKENS: unknown[] = [];
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: TOKENS, loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (e: Error) => e.message,
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => [vi.fn(), null] }));
vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/components/SistemaTabs', () => ({ SistemaTabs: () => null }));
vi.mock('@/components/StateView', () => ({
  StateView: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/LeadCaptureCard', () => ({
  LeadCaptureCard: () => <div data-testid="card-chave-leads" />,
}));
vi.mock('@/components/PedidoSiteChaveCard', () => ({
  PedidoSiteChaveCard: () => <div data-testid="card-chave-pedidos" />,
}));

import TokensApiPage from './TokensApiPage';

beforeEach(() => {
  papel = 'DIRECTOR';
});
afterEach(() => cleanup());

describe('Tokens de API — chaves do site', () => {
  it.each(['DIRECTOR', 'ADMIN'])('%s vê as duas chaves do site', (p) => {
    papel = p;
    const { getByTestId, getByRole } = render(<TokensApiPage />);
    expect(getByRole('heading', { name: 'Chaves do site' })).toBeTruthy();
    expect(getByTestId('card-chave-leads')).toBeTruthy();
    expect(getByTestId('card-chave-pedidos')).toBeTruthy();
  });

  it.each(['REP', 'GERENTE', 'SAC'])('%s não vê — o backend responderia 403', (p) => {
    papel = p;
    const { queryByTestId, queryByRole } = render(<TokensApiPage />);
    expect(queryByRole('heading', { name: 'Chaves do site' })).toBeNull();
    expect(queryByTestId('card-chave-leads')).toBeNull();
    expect(queryByTestId('card-chave-pedidos')).toBeNull();
  });
});
