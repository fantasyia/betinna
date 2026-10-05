import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const estado = vi.hoisted(() => ({
  role: 'DIRECTOR' as string | null,
  config: null as { id: string } | null,
  pathPedido: undefined as string | null | undefined,
}));

vi.mock('@/hooks/usePermission', () => ({ useRole: () => estado.role }));
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    estado.pathPedido = path;
    return { data: path ? estado.config : null, loading: false, error: null, refetch: vi.fn() };
  },
}));

import { CatalogoTabs } from './CatalogoTabs';

const montar = () =>
  render(
    <MemoryRouter>
      <CatalogoTabs />
    </MemoryRouter>,
  );

describe('CatalogoTabs — aba Vitrine só onde ela existe', () => {
  beforeEach(() => {
    estado.role = 'DIRECTOR';
    estado.config = null;
    estado.pathPedido = undefined;
  });
  afterEach(() => cleanup());

  it('empresa SEM vitrine: as abas de sempre, nada novo', () => {
    montar();
    expect(screen.queryByText('Vitrine')).toBeNull();
    expect(screen.getByText('Produtos')).toBeTruthy();
    expect(screen.getByText('Meu catálogo')).toBeTruthy();
  });

  it('empresa COM vitrine + diretor: mostra a aba Vitrine', () => {
    estado.config = { id: 'vit-1' };
    montar();
    expect(screen.getByText('Vitrine')).toBeTruthy();
  });

  it('REP nem consulta a config (e não vê a aba)', () => {
    estado.role = 'REP';
    estado.config = { id: 'vit-1' };
    montar();
    expect(estado.pathPedido).toBeNull();
    expect(screen.queryByText('Vitrine')).toBeNull();
  });
});
