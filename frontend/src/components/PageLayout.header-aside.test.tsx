import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageLayout } from './PageLayout';
import { DASHBOARD_MODULOS, RESIZABLE_MODULOS } from '@/hooks/useDashboardPrefs';

/**
 * Fatia direita do cabeçalho (`headerAside`) — onde os indicadores de vendas
 * passaram a morar (pedido do Léo, 21/08: a faixa entre o título e a barra de
 * pulso ficava vazia do lado direito, e os indicadores estavam no fim do
 * canvas, longe do primeiro olhar).
 */

vi.mock('@/hooks/usePermission', () => ({ useRole: () => 'ADMIN', usePermission: () => true }));
vi.mock('@/lib/permissions-store', () => ({
  getPermissoes: () => null,
  subscribePermissoes: () => () => undefined,
}));
vi.mock('@/hooks/useEmpresaLogo', () => ({ useEmpresaLogo: () => ({ logoUrl: null }) }));
vi.mock('@/hooks/useBadges', () => ({ useBadges: () => ({ vendas: 0, atendimento: 0 }) }));
vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => <i data-testid="sino" /> }));
vi.mock('@/components/EmpresaSwitcher', () => ({ EmpresaSwitcher: () => null }));
vi.mock('@/components/FavoritosBar', () => ({ FavoritosBar: () => null }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ['light', vi.fn(), vi.fn()] }));
vi.mock('@/lib/auth-store', () => ({ clearSession: vi.fn() }));

const montar = (aside?: React.ReactNode) =>
  render(
    <MemoryRouter>
      <PageLayout
        title="Dashboard"
        actions={<button data-testid="acao">Personalizar</button>}
        headerAside={aside}
      >
        <div data-testid="miolo">miolo</div>
      </PageLayout>
    </MemoryRouter>,
  );

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

describe('PageLayout — fatia do cabeçalho', () => {
  it('renderiza a fatia DENTRO do cabeçalho, não no miolo da página', () => {
    montar(<div data-testid="kpis">indicadores</div>);

    const cabecalho = document.querySelector('#main-content > header')!;
    expect(cabecalho.contains(screen.getByTestId('kpis'))).toBe(true);
  });

  it('a fatia fica DEPOIS dos botões de ação — eles continuam no topo', () => {
    montar(<div data-testid="kpis">indicadores</div>);

    const acao = screen.getByTestId('acao');
    const kpis = screen.getByTestId('kpis');
    // compareDocumentPosition: FOLLOWING = 4
    expect(acao.compareDocumentPosition(kpis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sem fatia, o cabeçalho é o de sempre (nenhuma página existente muda)', () => {
    montar();

    expect(screen.getByTestId('acao')).toBeTruthy();
    expect(screen.getByTestId('sino')).toBeTruthy();
    expect(screen.getByTestId('miolo')).toBeTruthy();
  });
});

describe('Indicadores de vendas fora do canvas', () => {
  it('continuam podendo ser escondidos no Personalizar', () => {
    expect(DASHBOARD_MODULOS.some((m) => m.key === 'kpis')).toBe(true);
  });

  it('NÃO oferecem escolha de largura — no cabeçalho ela não é do usuário', () => {
    // Um botão de largura que não muda nada é pior que não ter botão: o
    // usuário clica, nada acontece, e ele conclui que a tela está quebrada.
    expect(RESIZABLE_MODULOS).not.toContain('kpis');
  });

  it('os demais módulos do canvas seguem redimensionáveis', () => {
    for (const k of ['fluxosSala', 'calendario', 'graficos', 'topReps', 'funil', 'atalhos']) {
      expect(RESIZABLE_MODULOS).toContain(k);
    }
  });
});
