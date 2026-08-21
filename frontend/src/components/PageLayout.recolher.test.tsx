import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageLayout } from './PageLayout';

/**
 * Sidebar recolhível (pedido do Léo, 21/08).
 *
 * O que precisa ficar travado não é o CSS — é o que a tela promete:
 *  - dá pra recolher e expandir;
 *  - a escolha SOBREVIVE ao recarregar (é preferência de dispositivo);
 *  - recolhida, o conteúdo ganha a largura (senão a coluna encolhe e sobra buraco);
 *  - nenhuma informação some em silêncio: rótulo vira title/aria-label e o
 *    badge numérico vira ponto.
 */

vi.mock('@/hooks/usePermission', () => ({
  useRole: () => 'ADMIN',
  usePermission: () => true,
}));

vi.mock('@/lib/permissions-store', () => ({
  getPermissoes: () => null,
  subscribePermissoes: () => () => undefined,
}));

vi.mock('@/hooks/useEmpresaLogo', () => ({ useEmpresaLogo: () => ({ logoUrl: null }) }));

// Atendimento com 3 novidades (a chave do badge é `atendimento`; a rota é
// `/inbox`): é o que prova o ponto vermelho no modo recolhido.
vi.mock('@/hooks/useBadges', () => ({ useBadges: () => ({ vendas: 0, atendimento: 3 }) }));

vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/EmpresaSwitcher', () => ({
  EmpresaSwitcher: () => <div data-testid="empresa-switcher" />,
}));
vi.mock('@/components/FavoritosBar', () => ({ FavoritosBar: () => null }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ['light', vi.fn(), vi.fn()] }));
vi.mock('@/lib/auth-store', () => ({ clearSession: vi.fn() }));

const montar = () =>
  render(
    <MemoryRouter>
      <PageLayout title="Dashboard">
        <div>miolo</div>
      </PageLayout>
    </MemoryRouter>,
  );

const sidebar = () => screen.getByTestId('sidebar');
const main = () => document.getElementById('main-content')!;

beforeEach(() => {
  localStorage.clear();
  // O hook decide desktop/mobile por matchMedia; sem stub, jsdom devolve
  // `matches: false` = desktop, que é o caso deste arquivo.
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

describe('Sidebar — recolher e expandir', () => {
  it('abre expandida por padrão', () => {
    montar();

    expect(sidebar().getAttribute('data-recolhida')).toBe('nao');
    expect(screen.getByTestId('sidebar-recolher')).toBeTruthy();
  });

  it('clicar em recolher encolhe a coluna E devolve a largura pro conteúdo', () => {
    montar();
    const antes = main().style.marginLeft;

    fireEvent.click(screen.getByTestId('sidebar-recolher'));

    expect(sidebar().getAttribute('data-recolhida')).toBe('sim');
    // O miolo TEM que acompanhar — senão a sidebar encolhe e fica um buraco.
    expect(main().style.marginLeft).not.toBe(antes);
    expect(parseInt(main().style.marginLeft, 10)).toBeLessThan(parseInt(antes, 10));
  });

  it('recolhida, o botão vira "expandir" e volta ao estado anterior', () => {
    montar();

    fireEvent.click(screen.getByTestId('sidebar-recolher'));
    expect(screen.queryByTestId('sidebar-recolher')).toBeNull();

    fireEvent.click(screen.getByTestId('sidebar-expandir'));
    expect(sidebar().getAttribute('data-recolhida')).toBe('nao');
  });

  it('a escolha sobrevive ao recarregar — é preferência do dispositivo', () => {
    montar();
    fireEvent.click(screen.getByTestId('sidebar-recolher'));
    cleanup();

    montar(); // "recarregou"

    expect(sidebar().getAttribute('data-recolhida')).toBe('sim');
  });

  it('recolhida, o rótulo do item vira nome acessível — não some pro leitor de tela', () => {
    montar();
    // Expandida o rótulo é texto visível. (`textContent` traz rótulo + badge
    // grudados — "Atendimento3" —, por isso a checagem é por conter.)
    expect(screen.getByTestId('nav-inbox').textContent).toContain('Atendimento');

    fireEvent.click(screen.getByTestId('sidebar-recolher'));

    const recolhido = screen.getByTestId('nav-inbox');
    expect(recolhido.textContent).not.toContain('Atendimento');
    expect(recolhido.getAttribute('aria-label')).toBe('Atendimento');
    // O title carrega o rótulo E a contagem, que o número perdeu ao virar ponto.
    expect(recolhido.getAttribute('title')).toBe('Atendimento (3)');
  });

  it('recolhida, o badge numérico vira ponto — novidade não pode sumir', () => {
    montar();
    expect(screen.getByTestId('nav-badge-inbox').textContent).toBe('3');

    fireEvent.click(screen.getByTestId('sidebar-recolher'));

    expect(screen.queryByTestId('nav-badge-inbox')).toBeNull();
    expect(screen.getByTestId('nav-dot-inbox')).toBeTruthy();
  });

  it('recolhida, o seletor de empresa sai (não existe versão honesta dele em 60px)', () => {
    montar();
    expect(screen.getByTestId('empresa-switcher')).toBeTruthy();

    fireEvent.click(screen.getByTestId('sidebar-recolher'));

    expect(screen.queryByTestId('empresa-switcher')).toBeNull();
  });

  it('sair continua alcançável recolhida — só perde o texto', () => {
    montar();
    fireEvent.click(screen.getByTestId('sidebar-recolher'));

    const sair = screen.getByTestId('logout-btn');
    expect(sair.textContent).not.toContain('Sair');
    expect(sair.getAttribute('aria-label')).toBe('Sair');
  });
});
