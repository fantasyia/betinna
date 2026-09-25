import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgendaHoje } from './AgendaHoje';

/**
 * Léo, 25/09: "isso aqui não me diz que tem algo certo". A agenda do robô
 * mostrava só o próximo horário, com "disparo automático", e sumia com ele
 * quando passava. Agora cada horário diz o que aconteceu, e as falhas das
 * últimas 72h ficam ali pra tratar rápido.
 */

afterEach(() => cleanup());

const robo = (hora: string, resultado: string, detalhe: string) => ({
  hora,
  titulo: 'R2 · Liberação de lote',
  tipo: 'robo' as const,
  detalhe,
  resultado: resultado as never,
  link: '/fluxos?edit=fx-r2',
});

describe('AgendaHoje', () => {
  it('cada horário do robô diz o que aconteceu, com a cor do resultado', () => {
    render(
      <MemoryRouter>
        <AgendaHoje
          itens={[
            robo('2026-09-25T12:00:00Z', 'sem_efeito', 'rodou — nada a fazer'),
            robo('2026-09-25T14:00:00Z', 'falhou', 'falhou — Evolution 400'),
            robo('2026-09-25T16:00:00Z', 'agendado', 'agendado'),
          ]}
        />
      </MemoryRouter>,
    );
    const linhas = screen.getAllByTestId('agenda-resultado');
    expect(linhas.map((l) => l.textContent)).toEqual([
      '🤖 rodou — nada a fazer',
      '🤖 falhou — Evolution 400',
      '🤖 agendado',
    ]);
    expect(linhas[1].className).toContain('text-danger');
  });

  it('lista as falhas das últimas 72h com fluxo, erro e link', () => {
    render(
      <MemoryRouter>
        <AgendaHoje
          itens={[]}
          falhas={[
            {
              id: 'f1',
              fluxoId: 'fx-e1',
              fluxoNome: 'E1 · Boas-vindas',
              erro: 'timeout no envio',
              em: new Date().toISOString(),
              link: '/fluxos?edit=fx-e1',
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('falhas-72h').textContent).toContain('Falhas nas últimas 72h(1)');
    const item = screen.getByTestId('falha-item');
    expect(item.textContent).toContain('E1 · Boas-vindas');
    expect(item.textContent).toContain('timeout no envio');
    expect(item.getAttribute('href')).toBe('/fluxos?edit=fx-e1');
  });

  it('sem falhas, diz isso — vazio de verdade, não bloco sumido', () => {
    render(
      <MemoryRouter>
        <AgendaHoje itens={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('falhas-72h').textContent).toContain('Nenhuma execução falhou.');
  });
});
