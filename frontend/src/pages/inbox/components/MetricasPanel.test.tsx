/**
 * Render-tests do MetricasPanel — trava o contrato de formatação e renderização.
 *
 * MetricasPanel não recebe props; usa useApiQuery('/inbox/metricas') internamente.
 * Mockamos useApiQuery pra controlar os dados injetados.
 *
 * vi.mock é hoisted pelo Vite — imports ficam após os mocks.
 */

import { vi, afterEach, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ─── mocks (antes dos imports de source) ────────────────────────────────────

let mockUseApiQueryReturn: { data: unknown; loading: boolean; error: unknown; refetch: () => void } =
  { data: null, loading: false, error: null, refetch: vi.fn() };

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => mockUseApiQueryReturn,
}));

// ─── source imports (após mocks) ────────────────────────────────────────────

import { MetricasPanel } from './MetricasPanel';
import type { Metricas } from '../lib/types';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeMetricas(overrides: Partial<Metricas> = {}): Metricas {
  return {
    conversas: {
      abertas: 10,
      pendentes: 3,
      resolvidas: 5,
      arquivadas: 2,
      total: 20,
    },
    aguardando: {
      total: 4,
      dentroDoPrazo: 3,
      estourado: 1,
      slaMinutos: 30,
    },
    tempoMedioPrimeiraRespostaSegundos: 90,
    porAtendente: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mockUseApiQueryReturn = { data: null, loading: false, error: null, refetch: vi.fn() };
});

// ─── testes ─────────────────────────────────────────────────────────────────

describe('MetricasPanel', () => {
  it('renderiza o cabeçalho colapsável', () => {
    render(<MetricasPanel />);
    expect(screen.getByTestId('inbox-metricas-toggle')).toBeTruthy();
    expect(screen.getByText('Métricas de atendimento')).toBeTruthy();
  });

  it('começa aberto (aria-expanded=true)', () => {
    render(<MetricasPanel />);
    const toggle = screen.getByTestId('inbox-metricas-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('exibe "Carregando métricas…" quando loading=true e data=null', () => {
    mockUseApiQueryReturn = { data: null, loading: true, error: null, refetch: vi.fn() };
    render(<MetricasPanel />);
    expect(screen.getByText('Carregando métricas…')).toBeTruthy();
  });

  it('exibe mensagem de erro quando error=true e data=null', () => {
    mockUseApiQueryReturn = {
      data: null,
      loading: false,
      error: new Error('fail'),
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);
    expect(screen.getByText('Não foi possível carregar as métricas.')).toBeTruthy();
  });

  it('renderiza os KPIs quando data chega (conversas.abertas, aguardando.total, total)', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);

    // Stat cards via data-testid
    expect(screen.getByTestId('inbox-metricas-abertas')).toBeTruthy();
    expect(screen.getByTestId('inbox-metricas-aguardando')).toBeTruthy();
    expect(screen.getByTestId('inbox-metricas-tmr')).toBeTruthy();
    expect(screen.getByTestId('inbox-metricas-total')).toBeTruthy();
  });

  it('exibe os valores numéricos corretos das métricas', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas({
        conversas: { abertas: 42, pendentes: 7, resolvidas: 11, arquivadas: 3, total: 63 },
        aguardando: { total: 8, dentroDoPrazo: 5, estourado: 3, slaMinutos: 30 },
      }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);

    // Valor "abertas" (42) aparece no DOM
    const abertasCard = screen.getByTestId('inbox-metricas-abertas');
    expect(abertasCard.textContent).toContain('42');

    // Valor "total" (63) aparece no DOM
    const totalCard = screen.getByTestId('inbox-metricas-total');
    expect(totalCard.textContent).toContain('63');

    // Valor "aguardando" total (8) aparece
    const aguardandoCard = screen.getByTestId('inbox-metricas-aguardando');
    expect(aguardandoCard.textContent).toContain('8');
  });

  it('formata tempoMedioPrimeiraRespostaSegundos < 60 como segundos (ex: 45s)', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas({ tempoMedioPrimeiraRespostaSegundos: 45 }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);
    const tmrCard = screen.getByTestId('inbox-metricas-tmr');
    expect(tmrCard.textContent).toContain('45s');
  });

  it('formata tempoMedioPrimeiraRespostaSegundos em minutos (ex: 2min para 120s)', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas({ tempoMedioPrimeiraRespostaSegundos: 120 }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);
    const tmrCard = screen.getByTestId('inbox-metricas-tmr');
    expect(tmrCard.textContent).toContain('2min');
  });

  it('formata tempoMedioPrimeiraRespostaSegundos em horas+min (ex: 1h 30min para 5400s)', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas({ tempoMedioPrimeiraRespostaSegundos: 5400 }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);
    const tmrCard = screen.getByTestId('inbox-metricas-tmr');
    expect(tmrCard.textContent).toContain('1h 30min');
  });

  it('formata tempoMedioPrimeiraRespostaSegundos null como "—"', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas({ tempoMedioPrimeiraRespostaSegundos: null }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);
    const tmrCard = screen.getByTestId('inbox-metricas-tmr');
    expect(tmrCard.textContent).toContain('—');
  });

  it('exibe lista por atendente quando porAtendente tem itens', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas({
        porAtendente: [
          { atendenteId: 'a1', atendenteNome: 'Pedro', abertas: 5, aguardando: 2 },
          { atendenteId: 'a2', atendenteNome: 'Lucia', abertas: 3, aguardando: 0 },
        ],
      }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);

    const atendentes = screen.getByTestId('inbox-metricas-atendentes');
    expect(atendentes).toBeTruthy();
    expect(atendentes.textContent).toContain('Pedro');
    expect(atendentes.textContent).toContain('Lucia');
  });

  it('limita a lista de atendentes a 8 (slice)', () => {
    const porAtendente = Array.from({ length: 10 }, (_, i) => ({
      atendenteId: `a${i}`,
      atendenteNome: `Atendente ${i}`,
      abertas: i,
      aguardando: 0,
    }));
    mockUseApiQueryReturn = {
      data: makeMetricas({ porAtendente }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);

    // só os primeiros 8 aparecem; 'Atendente 8' e 'Atendente 9' não aparecem
    expect(screen.queryByText('Atendente 8')).toBeNull();
    expect(screen.queryByText('Atendente 9')).toBeNull();
    expect(screen.getByText('Atendente 0')).toBeTruthy();
    expect(screen.getByText('Atendente 7')).toBeTruthy();
  });

  it('não exibe lista de atendentes quando porAtendente está vazio', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas({ porAtendente: [] }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);
    expect(screen.queryByTestId('inbox-metricas-atendentes')).toBeNull();
  });

  it('colapsar o painel oculta os dados (toggle fecha)', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);

    // aberto inicialmente — dados visíveis
    expect(screen.getByTestId('inbox-metricas-abertas')).toBeTruthy();

    // clicar no toggle fecha o painel
    fireEvent.click(screen.getByTestId('inbox-metricas-toggle'));

    // dados não devem mais estar no DOM
    expect(screen.queryByTestId('inbox-metricas-abertas')).toBeNull();

    // aria-expanded atualizado
    const toggle = screen.getByTestId('inbox-metricas-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('abrir painel novamente após colapsar exibe os dados', () => {
    mockUseApiQueryReturn = {
      data: makeMetricas(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<MetricasPanel />);

    // fechar
    fireEvent.click(screen.getByTestId('inbox-metricas-toggle'));
    expect(screen.queryByTestId('inbox-metricas-abertas')).toBeNull();

    // reabrir
    fireEvent.click(screen.getByTestId('inbox-metricas-toggle'));
    expect(screen.getByTestId('inbox-metricas-abertas')).toBeTruthy();
  });
});
