import { describe, it, expect } from 'vitest';
import { montarCron } from './cron';

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
