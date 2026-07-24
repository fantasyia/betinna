/**
 * Testes do M8 — Gráficos de relatórios do dashboard.
 *
 * Cobertura:
 *  1. Renderiza os 5 gráficos (gestão) com filtros numa linha única
 *  2. REP (ehGestao=false): "Saúde dos fluxos" não renderiza
 *  3. Toggle Tabela: vista de tabela equivalente com os números do gráfico
 *  4. Export CSV: dispara download com as linhas da tabela equivalente
 *  5. Filtro de período: troca de 30d → 7d refaz a query com dias=7
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastMock, downloadCsvMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  downloadCsvMock: vi.fn(),
}));
vi.mock('@/components/toast', () => ({ useToast: () => toastMock }));

vi.mock('@/lib/csv', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/csv')>();
  return { ...orig, downloadCsv: downloadCsvMock };
});
vi.mock('@/lib/grafico-export', () => ({ svgParaPng: vi.fn().mockResolvedValue(undefined) }));

const RESP = {
  periodo: { de: '2026-07-17', ate: '2026-07-23', dias: 30 },
  funis: [
    { id: 'fun-1', nome: 'Clientes' },
    { id: 'fun-2', nome: 'Prospecção Reps' },
  ],
  funilSelecionado: { id: 'fun-1', nome: 'Clientes' },
  leadsPorDia: [
    { dia: '2026-07-22', total: 2 },
    { dia: '2026-07-23', total: 5 },
  ],
  utm: [
    { campanha: 'mb-lancamento', total: 12 },
    { campanha: 'Outros', total: 3 },
  ],
  conversaoFunil: [
    { id: 'et-1', nome: 'Novo', cor: '#111111', entradas: 10, taxaAvanco: 40 },
    { id: 'et-2', nome: 'Qualificando', cor: '#222222', entradas: 4, taxaAvanco: null },
  ],
  tempoPorEtapa: [
    { id: 'et-1', nome: 'Novo', cor: '#111111', dias: 2.3 },
    { id: 'et-2', nome: 'Qualificando', cor: '#222222', dias: null },
  ],
  saudeFluxos: [
    { dia: '2026-07-22', ok: 5, erro: 1 },
    { dia: '2026-07-23', ok: 8, erro: 0 },
  ],
};

const paths: string[] = [];
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path) paths.push(path);
    return { data: RESP, loading: false, error: null, refetch: vi.fn() };
  },
}));

import { RelatoriosGraficos } from './RelatoriosGraficos';

describe('RelatoriosGraficos (M8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paths.length = 0;
  });
  afterEach(cleanup);

  it('renderiza os 5 gráficos com a linha de filtros', () => {
    render(<RelatoriosGraficos ehGestao />);
    expect(screen.getByText('Leads ao longo do tempo')).toBeDefined();
    expect(screen.getByText('Origem por campanha (UTM)')).toBeDefined();
    expect(screen.getByText('Conversão do funil — Clientes')).toBeDefined();
    expect(screen.getByText('Saúde dos fluxos (execuções por dia)')).toBeDefined();
    expect(screen.getByText('Tempo médio por etapa — Clientes')).toBeDefined();
    // Filtros numa linha única: período + funil
    expect(screen.getByTestId('graficos-dias-7')).toBeDefined();
    expect(screen.getByTestId('graficos-funil')).toBeDefined();
  });

  it('REP: módulo de gestão "Saúde dos fluxos" não renderiza', () => {
    render(<RelatoriosGraficos ehGestao={false} />);
    expect(screen.queryByText('Saúde dos fluxos (execuções por dia)')).toBeNull();
    expect(screen.getByText('Leads ao longo do tempo')).toBeDefined();
  });

  it('toggle Tabela mostra a vista equivalente com os números', () => {
    render(<RelatoriosGraficos ehGestao />);
    fireEvent.click(screen.getByTestId('origem-utm-vista-tabela'));
    expect(screen.getByText('Campanha')).toBeDefined();
    expect(screen.getByText('mb-lancamento')).toBeDefined();
    expect(screen.getByText('12')).toBeDefined();
  });

  it('export CSV baixa as linhas da tabela equivalente', () => {
    render(<RelatoriosGraficos ehGestao />);
    fireEvent.click(screen.getByTestId('origem-utm-csv'));
    expect(downloadCsvMock).toHaveBeenCalledTimes(1);
    expect(downloadCsvMock.mock.calls[0][0]).toBe('origem-utm.csv');
    expect(downloadCsvMock.mock.calls[0][1]).toContain('mb-lancamento');
  });

  it('filtro de período refaz a query com dias=7', () => {
    render(<RelatoriosGraficos ehGestao />);
    expect(paths.at(-1)).toContain('dias=30');
    fireEvent.click(screen.getByTestId('graficos-dias-7'));
    expect(paths.at(-1)).toContain('dias=7');
  });
});
