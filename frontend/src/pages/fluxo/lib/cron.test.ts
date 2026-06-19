import { describe, it, expect } from 'vitest';
import { montarCron, montarCrons, traduzirCrons } from './cron';

/**
 * montarCron — campos amigáveis do wizard → expressão cron (min hora dia mês dow).
 * O job de agendamento lê essa string, então o formato precisa ser exato.
 */
describe('montarCron', () => {
  it('todo dia (default) → `M H * * *`', () => {
    expect(montarCron('todo_dia', '09:00', [], '')).toBe('0 9 * * *');
    // freq desconhecida cai no default
    expect(montarCron('qualquer', '09:00', [], '')).toBe('0 9 * * *');
  });

  it('dias úteis → `M H * * 1-5`', () => {
    expect(montarCron('dias_uteis', '08:30', [], '')).toBe('30 8 * * 1-5');
  });

  it('fim de semana → `M H * * 0,6`', () => {
    expect(montarCron('fim_de_semana', '10:15', [], '')).toBe('15 10 * * 0,6');
  });

  it('dias específicos (semanal) → usa os dias selecionados', () => {
    expect(montarCron('dias_especificos', '07:00', ['1', '3', '5'], '')).toBe('0 7 * * 1,3,5');
  });

  it('dias específicos sem seleção → cai pra segunda (1)', () => {
    expect(montarCron('dias_especificos', '07:00', [], '')).toBe('0 7 * * 1');
  });

  it('dia do mês (mensal) → `M H diaMes * *`', () => {
    expect(montarCron('dia_do_mes', '06:00', [], '15')).toBe('0 6 15 * *');
    // sem dia informado → dia 1
    expect(montarCron('dia_do_mes', '06:00', [], '')).toBe('0 6 1 * *');
  });

  it('horário vazio → assume 09:00', () => {
    expect(montarCron('todo_dia', '', [], '')).toBe('0 9 * * *');
  });

  it('clampa hora/minuto fora do range', () => {
    expect(montarCron('todo_dia', '99:99', [], '')).toBe('59 23 * * *');
  });
});

describe('montarCrons (array — wizard novo)', () => {
  it('múltiplos horários → uma expressão por horário', () => {
    expect(
      montarCrons({ cronFreq: 'dias_uteis', cronHorarios: ['09:00', '14:00'] }),
    ).toEqual(['0 9 * * 1-5', '0 14 * * 1-5']);
  });

  it('back-compat: lê cronHorario (singular) quando não há cronHorarios', () => {
    expect(montarCrons({ cronFreq: 'todo_dia', cronHorario: '08:30' })).toEqual(['30 8 * * *']);
  });

  it('a cada N minutos → */N', () => {
    expect(montarCrons({ cronFreq: 'cada_n_min', cronIntervaloN: 15 })).toEqual(['*/15 * * * *']);
  });

  it('a cada N horas → 0 */N', () => {
    expect(montarCrons({ cronFreq: 'cada_n_horas', cronIntervaloN: 2 })).toEqual(['0 */2 * * *']);
  });

  it('janela: a cada 30min das 9 às 18 em dias úteis', () => {
    expect(
      montarCrons({
        cronFreq: 'intervalo',
        cronIntervaloN: 30,
        cronJanelaUnidade: 'min',
        cronJanelaInicio: '9',
        cronJanelaFim: '18',
        cronJanelaDias: 'dias_uteis',
      }),
    ).toEqual(['*/30 9-18 * * 1-5']);
  });

  it('janela em horas: a cada 2h das 8 às 20 todos os dias', () => {
    expect(
      montarCrons({
        cronFreq: 'intervalo',
        cronIntervaloN: 2,
        cronJanelaUnidade: 'horas',
        cronJanelaInicio: '8',
        cronJanelaFim: '20',
        cronJanelaDias: 'todos',
      }),
    ).toEqual(['0 8-20/2 * * *']);
  });

  it('dedup de horários repetidos', () => {
    expect(
      montarCrons({ cronFreq: 'todo_dia', cronHorarios: ['09:00', '09:00'] }),
    ).toEqual(['0 9 * * *']);
  });

  it('clampa N do intervalo (999→59, 0→1, NaN→default)', () => {
    expect(montarCrons({ cronFreq: 'cada_n_min', cronIntervaloN: 999 })).toEqual(['*/59 * * * *']);
    expect(montarCrons({ cronFreq: 'cada_n_min', cronIntervaloN: 0 })).toEqual(['*/1 * * * *']);
    expect(montarCrons({ cronFreq: 'cada_n_min', cronIntervaloN: 'abc' })).toEqual([
      '*/15 * * * *',
    ]);
  });
});

describe('traduzirCrons (humanização pt-BR)', () => {
  it('traduz expressão simples', () => {
    expect(traduzirCrons(['0 9 * * 1-5']).toLowerCase()).toContain('09:00');
  });

  it('junta múltiplas com " · "', () => {
    const t = traduzirCrons(['0 9 * * *', '0 14 * * *']);
    expect(t).toContain(' · ');
  });

  it('expressão inválida (não 5 campos) é descartada', () => {
    expect(traduzirCrons(['2'])).toBe('');
  });
});
