import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const estado = vi.hoisted(() => ({
  role: 'DIRECTOR' as string | null,
  config: null as { id: string } | null,
  precificacao: null as { ativa: boolean } | null,
  paths: [] as Array<string | null>,
}));

vi.mock('@/hooks/usePermission', () => ({ useRole: () => estado.role }));
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    estado.paths.push(path);
    const data =
      path === '/vitrine/admin/config'
        ? estado.config
        : path === '/precificacao/status'
          ? estado.precificacao
          : null;
    return { data, loading: false, error: null, refetch: vi.fn() };
  },
}));

import { CatalogoTabs } from './CatalogoTabs';

const montar = () =>
  render(
    <MemoryRouter>
      <CatalogoTabs />
    </MemoryRouter>,
  );

describe('CatalogoTabs — abas Vitrine e Precificação só onde existem', () => {
  beforeEach(() => {
    estado.role = 'DIRECTOR';
    estado.config = null;
    estado.precificacao = null;
    estado.paths = [];
  });
  afterEach(() => cleanup());

  it('empresa SEM vitrine nem calculadora: as abas de sempre, nada novo', () => {
    estado.precificacao = { ativa: false };
    montar();
    expect(screen.queryByText('Vitrine')).toBeNull();
    expect(screen.queryByText('Precificação')).toBeNull();
    expect(screen.getByText('Produtos')).toBeTruthy();
    expect(screen.getByText('Meu catálogo')).toBeTruthy();
  });

  it('empresa COM vitrine + diretor: mostra a aba Vitrine', () => {
    estado.config = { id: 'vit-1' };
    montar();
    expect(screen.getByText('Vitrine')).toBeTruthy();
  });

  it('calculadora ligada + diretor: mostra a aba Precificação', () => {
    estado.precificacao = { ativa: true };
    montar();
    expect(screen.getByText('Precificação')).toBeTruthy();
  });

  it('REP nem consulta (e não vê nenhuma das duas abas)', () => {
    estado.role = 'REP';
    estado.config = { id: 'vit-1' };
    estado.precificacao = { ativa: true };
    montar();
    expect(estado.paths.every((p) => p === null)).toBe(true);
    expect(screen.queryByText('Vitrine')).toBeNull();
    expect(screen.queryByText('Precificação')).toBeNull();
  });
});
