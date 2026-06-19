import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import { CronTriggerConfig } from './CronTriggerConfig';

/**
 * Render-tests do CronTriggerConfig — travam o CONTRATO config-key↔controle.
 *
 * O form recebe { config, onUpdate } direto (não `data`) e o onUpdate é um
 * updater (data) => data. Como os controles são CONTROLADOS (value=prop) e o
 * onUpdate aqui é um mock que NÃO atualiza o pai, o React reverte o `value` do
 * DOM no re-render. O handler do form lê `e.target.value` de forma preguiçosa
 * (dentro do updater), então precisamos APLICAR o updater no exato momento do
 * evento — antes da reversão. Por isso o mock aplica o updater na hora e guarda
 * o resultado, em vez de capturá-lo depois via `.mock.calls`.
 */

// O form dispara um POST debounced de preview (/fluxos/cron/preview). Mockamos
// o client pra não tocar a rede; o método usado é `api.post`.
vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(() => Promise.resolve({ valido: true, proximas: [] })),
  },
}));

/** NodePayload base (gatilho cron, modo wizard) com config representativo. */
function makeData(config: Record<string, unknown>): NodePayload {
  return {
    titulo: 'Cron agendado',
    tipo: 'TRIGGER',
    triggerTipo: 'CRON_AGENDADO',
    config,
  };
}

/**
 * onUpdate que aplica cada updater na hora (lendo e.target.value antes do
 * re-render reverter o controle) e expõe o último resultado em `.last`.
 */
function makeOnUpdate(seed: NodePayload) {
  const fn = vi.fn((updater: (d: NodePayload) => NodePayload) => {
    fn.last = updater(seed);
  }) as ReturnType<typeof vi.fn> & { last: NodePayload | null };
  fn.last = null;
  return fn;
}

describe('CronTriggerConfig', () => {
  beforeEach(() => {
    cleanup();
  });

  it('reflete o config inicial do wizard nos controles (round-trip de leitura)', () => {
    const data = makeData({
      cronFreq: 'todo_dia',
      cronHorario: '08:30',
      timezone: 'UTC',
      expressao: '30 8 * * *',
    });
    const onUpdate = makeOnUpdate(data);
    const { container } = render(<CronTriggerConfig config={data.config} onUpdate={onUpdate} />);

    // Frequência é o 1º combobox; Fuso horário é o último.
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0].value).toBe('todo_dia');
    expect(selects[selects.length - 1].value).toBe('UTC');

    // Horário no input type=time.
    const time = container.querySelector('input[type="time"]') as HTMLInputElement;
    expect(time.value).toBe('08:30');
  });

  it('mudar Frequência grava cronFreq E recalcula a expressao (montarCron)', () => {
    const data = makeData({
      cronFreq: 'todo_dia',
      cronHorario: '09:00',
      timezone: 'America/Sao_Paulo',
      expressao: '0 9 * * *',
    });
    const onUpdate = makeOnUpdate(data);
    render(<CronTriggerConfig config={data.config} onUpdate={onUpdate} />);

    const freqSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(freqSelect, { target: { value: 'dias_uteis' } });

    expect(onUpdate).toHaveBeenCalled();
    expect(onUpdate.last!.config.cronFreq).toBe('dias_uteis');
    // montarCron('dias_uteis', '09:00', ...) => '0 9 * * 1-5'
    expect(onUpdate.last!.config.expressao).toBe('0 9 * * 1-5');
  });

  it('mudar Horário grava cronHorarios E recalcula a expressao', () => {
    const data = makeData({
      cronFreq: 'todo_dia',
      cronHorario: '09:00',
      timezone: 'America/Sao_Paulo',
      expressao: '0 9 * * *',
    });
    const onUpdate = makeOnUpdate(data);
    const { container } = render(<CronTriggerConfig config={data.config} onUpdate={onUpdate} />);

    const time = container.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(time, { target: { value: '14:30' } });

    expect(onUpdate.last!.config.cronHorarios).toEqual(['14:30']);
    // todo_dia com 14:30 => '30 14 * * *'
    expect(onUpdate.last!.config.expressao).toBe('30 14 * * *');
    expect(onUpdate.last!.config.expressoes).toEqual(['30 14 * * *']);
  });

  it('múltiplos horários geram uma expressão por horário', () => {
    const data = makeData({
      cronFreq: 'dias_uteis',
      cronHorarios: ['09:00', '14:00'],
      timezone: 'America/Sao_Paulo',
      expressoes: ['0 9 * * 1-5', '0 14 * * 1-5'],
    });
    const onUpdate = makeOnUpdate(data);
    render(<CronTriggerConfig config={data.config} onUpdate={onUpdate} />);

    // "+ adicionar horário" empurra mais um.
    fireEvent.click(screen.getByTestId('cron-horario-add'));
    expect(onUpdate.last!.config.expressoes).toEqual([
      '0 9 * * 1-5',
      '0 14 * * 1-5',
      '0 12 * * 1-5',
    ]);
  });

  it('frequência "a cada N minutos" monta */N', () => {
    const data = makeData({
      cronFreq: 'cada_n_min',
      cronIntervaloN: 15,
      timezone: 'America/Sao_Paulo',
      expressoes: ['*/15 * * * *'],
    });
    const onUpdate = makeOnUpdate(data);
    render(<CronTriggerConfig config={data.config} onUpdate={onUpdate} />);

    fireEvent.change(screen.getByTestId('cron-intervalo-n'), { target: { value: '20' } });
    expect(onUpdate.last!.config.expressoes).toEqual(['*/20 * * * *']);
  });

  it('template "Dias úteis 9h e 14h" preenche os 2 horários', () => {
    const data = makeData({
      cronFreq: 'todo_dia',
      cronHorario: '09:00',
      timezone: 'America/Sao_Paulo',
      expressoes: ['0 9 * * *'],
    });
    const onUpdate = makeOnUpdate(data);
    render(<CronTriggerConfig config={data.config} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTestId('cron-template-Dias úteis 9h e 14h'));
    expect(onUpdate.last!.config.cronAvancado).toBe(false);
    expect(onUpdate.last!.config.expressoes).toEqual(['0 9 * * 1-5', '0 14 * * 1-5']);
  });

  it('marcar "pular feriados" grava pularFeriados', () => {
    const data = makeData({
      cronFreq: 'todo_dia',
      cronHorario: '09:00',
      timezone: 'America/Sao_Paulo',
      expressoes: ['0 9 * * *'],
    });
    const onUpdate = makeOnUpdate(data);
    render(<CronTriggerConfig config={data.config} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTestId('cron-pular-feriados'));
    expect(onUpdate.last!.config.pularFeriados).toBe(true);
  });

  it('mudar Fuso horário grava timezone (config-only)', () => {
    const data = makeData({
      cronFreq: 'todo_dia',
      cronHorario: '09:00',
      timezone: 'America/Sao_Paulo',
      expressao: '0 9 * * *',
    });
    const onUpdate = makeOnUpdate(data);
    render(<CronTriggerConfig config={data.config} onUpdate={onUpdate} />);

    const tzSelect = screen.getAllByRole('combobox').at(-1) as HTMLSelectElement;
    fireEvent.change(tzSelect, { target: { value: 'America/Manaus' } });

    expect(onUpdate.last!.config.timezone).toBe('America/Manaus');
  });

  it('no modo avançado, editar a expressão grava a expressao crua (sem recalcular)', () => {
    const data = makeData({
      cronFreq: 'todo_dia',
      cronHorario: '09:00',
      timezone: 'America/Sao_Paulo',
      expressao: '0 9 * * *',
      cronAvancado: true,
    });
    const onUpdate = makeOnUpdate(data);
    const { container } = render(<CronTriggerConfig config={data.config} onUpdate={onUpdate} />);

    // No avançado o input de horário some; sobra o input de texto da expressão.
    const expr = container.querySelector(
      'input[placeholder="min hora dia mês dia-semana"]',
    ) as HTMLInputElement;
    expect(expr.value).toBe('0 9 * * *');

    fireEvent.change(expr, { target: { value: '*/15 * * * *' } });
    expect(onUpdate.last!.config.expressao).toBe('*/15 * * * *');
  });
});
