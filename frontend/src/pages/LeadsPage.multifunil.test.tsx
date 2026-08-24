import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LeadsPage from './LeadsPage';

/**
 * Funil: VÁRIOS funis ao mesmo tempo, empilhados (pedido do Léo 21/08 —
 * "gostaria de ver vários funis ao mesmo tempo, só rolando a página pra baixo").
 *
 * O que interessa travar aqui é o CONTRATO da tela, não o kanban em si:
 *  - abre no funil padrão;
 *  - marcar outro funil RENDERIZA um board a mais (não troca);
 *  - a tela nunca fica sem funil nenhum;
 *  - a ordem é a do `/funis` (campo `ordem`), não a ordem de clique.
 */
const FUNIS = [
  { id: 'f-a', nome: 'A · Canal Reps', cor: '#111', ordem: 0, ativo: true, isPadrao: true, etapas: [] },
  { id: 'f-b', nome: 'B · Canal Próprio', cor: '#222', ordem: 1, ativo: true, isPadrao: false, etapas: [] },
];

const kanbanVazio = (id: string, nome: string) => ({
  funil: { id, nome, cor: '#111', etapas: [] },
  grupos: {},
  totaisPorEtapa: {},
});

// O mock CACHEIA por path: o useApiQuery real devolve referência estável (o
// TanStack faz structural sharing), e o board tem `useEffect([data])`. Um mock
// que cria objeto novo a cada render vira loop infinito — e o loop é do
// harness, não do componente.
const cacheQuery = new Map<string, unknown>();
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    const refetch = vi.fn();
    if (path === '/funis') return { data: FUNIS, loading: false, error: null, refetch };
    if (typeof path === 'string' && path.startsWith('/leads/kanban')) {
      const id = new URLSearchParams(path.split('?')[1] ?? '').get('funilId') ?? '';
      if (!cacheQuery.has(path)) {
        cacheQuery.set(path, kanbanVazio(id, id === 'f-a' ? 'A · Canal Reps' : 'B · Canal Próprio'));
      }
      return { data: cacheQuery.get(path), loading: false, error: null, refetch };
    }
    return { data: null, loading: false, error: null, refetch };
  },
}));

vi.mock('@/hooks/usePermission', () => ({
  useRole: () => 'ADMIN',
  usePermission: () => true,
}));

vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/lib/auth-store', () => ({ getSession: () => ({ user: { id: 'u-1' } }) }));

vi.mock('@/components/CrmTabs', () => ({ CrmTabs: () => null }));
vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));

const montar = () =>
  render(
    <MemoryRouter>
      <LeadsPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => cleanup());

describe('Funil — vários funis ao mesmo tempo', () => {
  it('abre com UM board: o funil padrão', async () => {
    montar();

    await waitFor(() => {
      expect(document.querySelector('[data-testid="funil-board-f-a"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-testid="funil-board-f-b"]')).toBeNull();
  });

  it('marcar o segundo funil ACRESCENTA um board — não troca de funil', async () => {
    montar();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="funil-board-f-a"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('funil-selector'));
    fireEvent.click(screen.getByTestId('funil-opt-f-b').querySelector('input')!);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="funil-board-f-b"]')).toBeTruthy();
    });
    // O primeiro CONTINUA na tela — é o ponto do pedido.
    expect(document.querySelector('[data-testid="funil-board-f-a"]')).toBeTruthy();
  });

  it('desmarcar o ÚLTIMO funil é no-op — a tela nunca fica sem kanban', async () => {
    montar();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="funil-board-f-a"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('funil-selector'));
    fireEvent.click(screen.getByTestId('funil-opt-f-a').querySelector('input')!);

    expect(document.querySelector('[data-testid="funil-board-f-a"]')).toBeTruthy();
  });

  it('a ordem dos boards é a do /funis, não a ordem em que foram marcados', async () => {
    montar();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="funil-board-f-a"]')).toBeTruthy();
    });

    // Marca o B (que vem DEPOIS do A no /funis) — mesmo assim o A renderiza antes.
    fireEvent.click(screen.getByTestId('funil-selector'));
    fireEvent.click(screen.getByTestId('funil-opt-f-b').querySelector('input')!);

    await waitFor(() => {
      const boards = [...document.querySelectorAll('[data-testid^="funil-board-"]')].map((el) =>
        el.getAttribute('data-testid'),
      );
      expect(boards).toEqual(['funil-board-f-a', 'funil-board-f-b']);
    });
  });
  it('a seleção SOBREVIVE ao recarregar — é preferência do usuário', async () => {
    montar();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="funil-board-f-a"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('funil-selector'));
    fireEvent.click(screen.getByTestId('funil-opt-f-b').querySelector('input')!);
    await waitFor(() => {
      expect(document.querySelector('[data-testid="funil-board-f-b"]')).toBeTruthy();
    });
    cleanup();

    montar(); // "recarregou"

    await waitFor(() => {
      expect(document.querySelector('[data-testid="funil-board-f-b"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-testid="funil-board-f-a"]')).toBeTruthy();
  });

  it('funil salvo que não existe mais é descartado — a tela não abre vazia', async () => {
    localStorage.setItem('betinna:funis-visiveis:u-1', JSON.stringify(['f-apagado']));

    montar();

    // Cai no padrão, como se fosse a primeira visita.
    await waitFor(() => {
      expect(document.querySelector('[data-testid="funil-board-f-a"]')).toBeTruthy();
    });
  });
});
