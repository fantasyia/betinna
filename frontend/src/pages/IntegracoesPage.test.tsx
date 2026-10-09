/**
 * Tela de Integrações redesenhada (29/09): conectadas viram cards em "Em uso",
 * o resto vira a lista "Disponíveis" agrupada por tipo, e o Tiny desconectado
 * vira o aviso da página.
 *
 * O que este teste trava é a SEPARAÇÃO — um serviço no grupo errado some da
 * vista de quem procura — e o contrato que o e2e usa: todo serviço tem
 * `servico-card-*` e `status-*`, e o desconectado diz "não conectado".
 */
import { render, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';

// Referências ESTÁVEIS por render, como o useApiQuery real.
let conexoes: Array<{ id: string; servico: string; ativo: boolean; criadoEm: string | null; atualizadoEm: string | null; ultimoSync?: string | null }> = [];
const refetch = vi.fn();
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string) => ({
    data: path === '/integracoes' ? conexoes : [],
    loading: false,
    error: null,
    refetch,
  }),
}));

let papel = 'DIRECTOR';
vi.mock('@/hooks/usePermission', () => ({ useRole: () => papel }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
  publicApiUrl: (p: string) => `https://api.exemplo.test${p}`,
}));
vi.mock('@/lib/auth-store', () => ({ getStoredEmpresaId: () => 'emp-1' }));
vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/components/StateView', () => ({
  StateView: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/SistemaTabs', () => ({ SistemaTabs: () => null }));
vi.mock('@/components/LeadCaptureCard', () => ({ LeadCaptureCard: () => null }));
vi.mock('@/components/PedidoSiteChaveCard', () => ({ PedidoSiteChaveCard: () => null }));
vi.mock('@/components/EmailTransacionalCard', () => ({ EmailTransacionalCard: () => null }));
vi.mock('@/components/EntradaAnunciosCard', () => ({ EntradaAnunciosCard: () => null }));
vi.mock('@/components/MetaPaginaCards', () => ({
  AssinaturaPaginaMeta: () => null,
  EscolherPaginaMeta: () => null,
}));

import IntegracoesPage from './IntegracoesPage';

const SERVICOS = [
  'tiny', 'whatsapp', 'openai', 'mercadolivre', 'shopee', 'amazon',
  'tiktok', 'meta_app', 'instagram', 'facebook', 'clicksign', 'asaas', 'melhorenvio',
  'meta_pixel',
];

const conexao = (servico: string) => ({
  id: `c-${servico}`,
  servico,
  ativo: true,
  criadoEm: '2026-09-29T12:00:00Z',
  atualizadoEm: null,
});

beforeEach(() => {
  papel = 'DIRECTOR';
  conexoes = [conexao('whatsapp'), conexao('mercadolivre')];
});
afterEach(() => cleanup());

describe('IntegracoesPage', () => {
  it('conectada vai pra "Em uso", com status e as ações de quem já está ligado', () => {
    const { getByRole } = render(<IntegracoesPage />);
    const emUso = getByRole('region', { name: /em uso/i });

    for (const s of ['whatsapp', 'mercadolivre']) {
      expect(within(emUso).getByTestId(`servico-card-${s}`)).toBeTruthy();
      expect(within(emUso).getByTestId(`status-${s}`).textContent).toMatch(/conectado/i);
      expect(within(emUso).getByTestId(`reconectar-${s}`)).toBeTruthy();
      expect(within(emUso).queryByTestId(`conectar-${s}`)).toBeNull();
    }
    // Só as conectadas: um desconectado aqui dentro seria card na seção errada.
    expect(within(emUso).queryByTestId('servico-card-shopee')).toBeNull();
  });

  it('não conectada vai pra "Disponíveis", no grupo do tipo dela, com "Conectar"', () => {
    const { getByRole } = render(<IntegracoesPage />);
    const disponiveis = getByRole('region', { name: /disponíveis/i });

    const shopee = within(disponiveis).getByTestId('servico-card-shopee');
    expect(within(disponiveis).getByTestId('status-shopee').textContent).toMatch(/não conectado/i);
    expect(within(disponiveis).getByTestId('conectar-shopee')).toBeTruthy();
    // Agrupada: o bloco da Shopee é o dos marketplaces.
    expect(shopee.parentElement?.textContent).toMatch(/Marketplaces/);
    expect(within(disponiveis).queryByTestId('servico-card-whatsapp')).toBeNull();
  });

  it('todo serviço aparece exatamente uma vez — o contrato que o e2e usa', () => {
    const { getAllByTestId } = render(<IntegracoesPage />);
    for (const s of SERVICOS) {
      expect(getAllByTestId(`servico-card-${s}`)).toHaveLength(1);
      expect(getAllByTestId(`status-${s}`)).toHaveLength(1);
    }
  });

  it('Tiny desconectado vira o aviso da página; conectado, o aviso some', () => {
    const { getByTestId, unmount } = render(<IntegracoesPage />);
    expect(getByTestId('aviso-tiny').textContent).toMatch(/Tiny ERP não conectado/);
    unmount();

    conexoes = [...conexoes, conexao('tiny')];
    const { queryByTestId } = render(<IntegracoesPage />);
    expect(queryByTestId('aviso-tiny')).toBeNull();
  });

  it('quem não é diretor/admin não vê "Conectar" nem o aviso — vê que é bloqueado', () => {
    papel = 'REP';
    const { queryByTestId, getByTestId } = render(<IntegracoesPage />);
    expect(queryByTestId('conectar-shopee')).toBeNull();
    expect(getByTestId('bloqueado-shopee')).toBeTruthy();
    expect(queryByTestId('reconectar-whatsapp')).toBeNull();
    expect(queryByTestId('aviso-tiny')).toBeNull();
  });
});
