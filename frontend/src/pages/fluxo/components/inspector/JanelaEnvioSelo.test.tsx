import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { JanelaEnvioSelo } from './JanelaEnvioSelo';

const mockQuery = vi.fn();
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (...args: unknown[]) => mockQuery(...args) as unknown,
}));

const REGRAS = {
  janela: { ativa: true, horaInicio: 8, horaFim: 20, dias: [0, 1, 2, 3, 4, 5, 6] },
  tetoDiario: { ativo: true, maxPorDia: 500 },
  conversaVivaHoras: 4,
};

const montar = (gatilho: string | null, data: unknown = REGRAS) => {
  mockQuery.mockReturnValue({ data, loading: false, refetch: vi.fn() });
  render(
    <MemoryRouter>
      <JanelaEnvioSelo gatilho={gatilho as never} />
    </MemoryRouter>,
  );
};

const texto = () => screen.getByTestId('selo-janela').textContent ?? '';

describe('JanelaEnvioSelo', () => {
  it('gatilho de mensagem: diz que responde a qualquer hora, sem citar horário', () => {
    montar('MENSAGEM_CANAL');
    expect(texto()).toMatch(/qualquer hora/i);
    expect(texto()).not.toMatch(/08h/);
  });

  it('LEAD_RESPONDEU também é isento', () => {
    montar('LEAD_RESPONDEU');
    expect(texto()).toMatch(/qualquer hora/i);
  });

  it('gatilho proativo: mostra o horário CONFIGURADO, não um fixo na tela', () => {
    montar('CRON_AGENDADO', {
      ...REGRAS,
      janela: { ativa: true, horaInicio: 9, horaFim: 18, dias: [1, 2, 3, 4, 5] },
    });
    expect(texto()).toContain('09h');
    expect(texto()).toContain('18h');
    expect(texto()).toMatch(/só em dia útil/i);
    // O número do teto também vem da config resolvida, não de string local.
    expect(texto()).toContain('500');
  });

  it('avisa que nada é descartado e cita a exceção de conversa viva', () => {
    montar('LEAD_RECEBEU_TAG');
    expect(texto()).toMatch(/nada é descartado/i);
    expect(texto()).toMatch(/4h/);
  });

  it('teto desligado some da lista (não anuncia regra que não existe)', () => {
    montar('CRON_AGENDADO', { ...REGRAS, tetoDiario: { ativo: false, maxPorDia: 500 } });
    expect(texto()).not.toMatch(/abordagens\/dia/i);
  });

  it('as duas travas desligadas: diz que envia a qualquer hora', () => {
    montar('CRON_AGENDADO', {
      ...REGRAS,
      janela: { ...REGRAS.janela, ativa: false },
      tetoDiario: { ativo: false, maxPorDia: 500 },
    });
    expect(texto()).toMatch(/qualquer hora/i);
  });

  it('config ainda carregando: NÃO chuta horário (some em vez de mentir)', () => {
    montar('CRON_AGENDADO', null);
    expect(screen.queryByTestId('selo-janela')).toBeNull();
  });

  it('o link leva pra aba certa das configurações', () => {
    montar('CRON_AGENDADO');
    expect(screen.getAllByTestId('selo-janela-link')[0].getAttribute('href')).toBe(
      '/configuracoes?tab=avancado#ritmo-envio',
    );
  });
});
