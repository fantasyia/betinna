import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CronVisualBuilder } from './CronVisualBuilder';

/**
 * CronVisualBuilder — estado local autoritativo (seedado do `value`). Testa o
 * parse das 5 colunas e a reconstrução da expressão a cada mudança.
 */
describe('CronVisualBuilder', () => {
  beforeEach(() => cleanup());

  it('seeda os 5 modos a partir da expressão', () => {
    render(<CronVisualBuilder value="0 9 * * 1-5" onChange={() => {}} />);
    const modos = screen.getAllByTestId(/cron-builder-modo-/) as HTMLSelectElement[];
    expect(modos[0].value).toBe('especifico'); // minuto "0"
    expect(modos[1].value).toBe('especifico'); // hora "9"
    expect(modos[2].value).toBe('qualquer'); // dia-mês "*"
    expect(modos[3].value).toBe('qualquer'); // mês "*"
    expect(modos[4].value).toBe('intervalo'); // dia-semana "1-5"
    // intervalo do dia-semana populado
    expect((screen.getByTestId('cron-builder-de-4') as HTMLInputElement).value).toBe('1');
    expect((screen.getByTestId('cron-builder-ate-4') as HTMLInputElement).value).toBe('5');
  });

  it('mudar minuto pra passo reconstrói a expressão', () => {
    const onChange = vi.fn();
    render(<CronVisualBuilder value="0 9 * * 1-5" onChange={onChange} />);

    fireEvent.change(screen.getByTestId('cron-builder-modo-0'), { target: { value: 'passo' } });
    expect(onChange).toHaveBeenLastCalledWith('*/1 9 * * 1-5');

    fireEvent.change(screen.getByTestId('cron-builder-passo-0'), { target: { value: '15' } });
    expect(onChange).toHaveBeenLastCalledWith('*/15 9 * * 1-5');
  });

  it('"Qualquer" vira * no campo', () => {
    const onChange = vi.fn();
    render(<CronVisualBuilder value="0 9 1 * *" onChange={onChange} />);
    fireEvent.change(screen.getByTestId('cron-builder-modo-2'), { target: { value: 'qualquer' } });
    expect(onChange).toHaveBeenLastCalledWith('0 9 * * *');
  });

  it('expressão vazia → tudo Qualquer (5 asteriscos)', () => {
    render(<CronVisualBuilder value="" onChange={() => {}} />);
    const modos = screen.getAllByTestId(/cron-builder-modo-/) as HTMLSelectElement[];
    expect(modos.every((m) => m.value === 'qualquer')).toBe(true);
  });
});
