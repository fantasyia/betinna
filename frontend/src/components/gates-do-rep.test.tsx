import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CrmTabs } from './CrmTabs';

/**
 * O que o REPRESENTANTE NÃO deve ver.
 *
 * Todos estes vazaram do mesmo jeito: a tela usava um gate que "quase" servia
 * — permissão de módulo compartilhada, ou nenhum gate — e o papel passava
 * junto. O prejuízo não é só visual: o rep clicava e tomava 403, ou pior,
 * conseguia mesmo (o caso do funil, onde mexer em funil pedia a MESMA
 * permissão de mover lead de etapa).
 */
const mockRole = vi.fn<() => string | null>(() => 'REP');
const mockPerm = vi.fn<(p: string) => boolean>(() => true);

vi.mock('@/hooks/usePermission', () => ({
  useRole: () => mockRole(),
  usePermission: (p: string) => mockPerm(p),
}));

const montarCrm = () =>
  render(
    <MemoryRouter>
      <CrmTabs />
    </MemoryRouter>,
  );

beforeEach(() => {
  mockRole.mockReturnValue('REP');
  mockPerm.mockReturnValue(true);
});
afterEach(() => cleanup());

describe('CrmTabs — "Configurar funis" é config de empresa', () => {
  it('REP NÃO vê "Configurar funis"', () => {
    // Estrutura de funil é config da empresa. A aba era empurrada sem condição
    // nenhuma — e o backend deixava passar porque mexer em funil pedia
    // `kanban:edit`, a MESMA permissão de arrastar card no quadro.
    montarCrm();

    expect(document.body.textContent).not.toContain('Configurar funis');
  });

  it('REP continua vendo o "Funil" — é o trabalho da carteira dele', () => {
    // A correção não pode levar junto a tela de trabalho.
    montarCrm();

    expect(document.body.textContent).toContain('Funil');
  });

  it.each(['ADMIN', 'DIRECTOR', 'GERENTE'])('%s vê "Configurar funis"', (role) => {
    mockRole.mockReturnValue(role);

    montarCrm();

    expect(document.body.textContent).toContain('Configurar funis');
  });
});
