/**
 * Contatos — VER e FILTRAR a origem do lead (card 🔎 21/08).
 *
 * O pedido do Léo foi explícito em NÃO resolver isso com tag espelho: o lead já
 * carrega `origemCadastro`/`formularioOrigem`, e etiqueta de origem poluiria a
 * régua de etiquetas (que roteia fluxo). Então o que precisa ficar travado aqui é:
 *  - a origem APARECE na linha;
 *  - o filtro vira query pro backend (inclusive os grupos inbound/outbound);
 *  - origem fora do vocabulário continua legível (o campo é VARCHAR, não enum).
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import ContatosPage from './ContatosPage';

/** Todos os paths que a página pediu — o filtro é verificado por aqui. */
const paths: string[] = [];

const contato = (over: Record<string, unknown> = {}) => ({
  chave: 'chave-1',
  nome: 'Alice',
  telefone: '11999990001',
  email: null,
  cidade: 'SP',
  uf: 'SP',
  tipos: ['LEAD'],
  tags: [],
  representante: null,
  leadId: 'lead-1',
  leadEtapa: 'NOVO',
  clienteId: null,
  clienteStatus: null,
  clienteERPStatus: null,
  conversaId: null,
  canal: null,
  ultimaInteracaoEm: null,
  criadoEm: '2026-08-01',
  origemCadastro: 'site',
  formularioOrigem: 'calculadora',
  ...over,
});

let linhas: unknown[] = [contato()];

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useLocation: () => ({ pathname: '/contatos' }),
}));

vi.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: (v: string) => v }));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => 'ADMIN',
  hasPermission: () => true,
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    const vazio = { data: null, loading: false, error: null, refetch: vi.fn() };
    if (path === null) return vazio;
    if (path.startsWith('/contatos')) {
      paths.push(path);
      return {
        data: { data: linhas, pagination: { page: 1, limit: 30, total: linhas.length, totalPages: 1 } },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (path === '/tags') return { data: [], loading: false, error: null, refetch: vi.fn() };
    return vazio;
  },
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
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

vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
  useIsMobile: () => false,
}));

vi.mock('@/components/CrmTabs', () => ({ CrmTabs: () => <nav /> }));
vi.mock('@/components/ImportLeadsModal', () => ({ ImportLeadsModal: () => null }));
vi.mock('@/components/ImportClientesModal', () => ({ ImportClientesModal: () => null }));
vi.mock('@/components/DuplicatasModal', () => ({ DuplicatasModal: () => null }));

/** Último path pedido pro /contatos. */
const ultimoPath = () => paths[paths.length - 1] ?? '';

afterEach(() => {
  cleanup();
  paths.length = 0;
  linhas = [contato()];
});

describe('Contatos — origem do lead na tela', () => {
  it('mostra a origem e o formulário na linha do contato', () => {
    render(<ContatosPage />);

    const cel = screen.getByTestId('contato-origem');
    expect(cel.textContent).toContain('Site');
    expect(cel.textContent).toContain('Calculadora');
  });

  it('origem fora do vocabulário aparece legível em vez de sumir (o campo é VARCHAR)', () => {
    linhas = [contato({ origemCadastro: 'porta_nova_2027', formularioOrigem: null })];
    render(<ContatosPage />);

    expect(screen.getByTestId('contato-origem').textContent).toContain('Porta nova 2027');
  });

  it('contato sem origem (cliente/conversa) mostra travessão, não quebra', () => {
    linhas = [contato({ origemCadastro: null, formularioOrigem: null, tipos: ['CONVERSA'] })];
    render(<ContatosPage />);

    expect(screen.queryByTestId('contato-origem')).toBeNull();
  });

  it('sem filtro, a busca NÃO manda origem nem formulário', () => {
    render(<ContatosPage />);

    expect(ultimoPath()).not.toContain('origem=');
    expect(ultimoPath()).not.toContain('formulario=');
  });

  it('marcar uma origem manda ?origem= pro backend', () => {
    render(<ContatosPage />);

    fireEvent.click(screen.getByTestId('contatos-origem-filtro-btn'));
    fireEvent.click(screen.getByTestId('contatos-origem-filtro-opt-site').querySelector('input')!);

    expect(ultimoPath()).toContain('origem=site');
  });

  it('o grupo inbound vai como grupo — quem expande é o backend, com a lista do gatilho', () => {
    render(<ContatosPage />);

    fireEvent.click(screen.getByTestId('contatos-origem-filtro-btn'));
    fireEvent.click(
      screen.getByTestId('contatos-origem-filtro-opt-inbound').querySelector('input')!,
    );

    // Se a tela expandisse aqui, a lista viveria em dois lugares e envelheceria só de um lado.
    expect(ultimoPath()).toContain('origem=inbound');
    expect(ultimoPath()).not.toContain('meta_lead_ads');
  });

  it('duas origens viram CSV (semântica OU)', () => {
    render(<ContatosPage />);

    fireEvent.click(screen.getByTestId('contatos-origem-filtro-btn'));
    fireEvent.click(screen.getByTestId('contatos-origem-filtro-opt-site').querySelector('input')!);
    fireEvent.click(
      screen.getByTestId('contatos-origem-filtro-opt-importacao').querySelector('input')!,
    );

    expect(decodeURIComponent(ultimoPath())).toContain('origem=site,importacao');
  });

  it('formulário é filtro próprio, separado da origem', () => {
    render(<ContatosPage />);

    fireEvent.click(screen.getByTestId('contatos-origem-filtro-btn'));
    fireEvent.click(
      screen.getByTestId('contatos-origem-filtro-opt-form-calculadora').querySelector('input')!,
    );

    expect(ultimoPath()).toContain('formulario=calculadora');
    expect(ultimoPath()).not.toContain('origem=');
  });

  it('limpar seleção tira os dois filtros da query', () => {
    render(<ContatosPage />);

    fireEvent.click(screen.getByTestId('contatos-origem-filtro-btn'));
    fireEvent.click(screen.getByTestId('contatos-origem-filtro-opt-site').querySelector('input')!);
    fireEvent.click(
      screen.getByTestId('contatos-origem-filtro-opt-form-amostra').querySelector('input')!,
    );
    fireEvent.click(screen.getByTestId('contatos-origem-filtro-limpar'));

    expect(ultimoPath()).not.toContain('origem=');
    expect(ultimoPath()).not.toContain('formulario=');
  });
});
