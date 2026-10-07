import { describe, expect, it } from 'vitest';
import { dataBr, hojeIso, intervaloPadrao, rotuloSituacao, somarDiasIso } from './tipos';

describe('financeiro — tela', () => {
  it('"hoje" é o dia de Brasília', () => {
    expect(hojeIso(new Date('2026-10-08T02:30:00Z'))).toBe('2026-10-07');
  });
  it('rótulo muda pelo lado (receber × pagar)', () => {
    expect(rotuloSituacao('QUITADO', 'RECEBER').texto).toBe('Recebido');
    expect(rotuloSituacao('QUITADO', 'PAGAR').texto).toBe('Pago');
    expect(rotuloSituacao('VENCIDO', 'PAGAR')).toEqual({ texto: 'Vencido', tom: 'danger' });
  });
});

describe('financeiro — fluxo (janelas)', () => {
  it('janela padrão de cada agrupamento', () => {
    expect(intervaloPadrao('dia', '2026-10-07')).toEqual({ de: '2026-09-30', ate: '2026-11-06' });
    expect(intervaloPadrao('semana', '2026-10-07')).toEqual({
      de: '2026-09-09',
      ate: '2026-12-02',
    });
    // 2 meses antes (1º dia) até 5 meses depois (último dia)
    expect(intervaloPadrao('mes', '2026-10-07')).toEqual({ de: '2026-08-01', ate: '2027-03-31' });
  });
  it('soma dias atravessando mês e ano; data em pt-BR', () => {
    expect(somarDiasIso('2026-12-30', 3)).toBe('2027-01-02');
    expect(dataBr('2026-10-20')).toBe('20/10/2026');
    expect(dataBr(null)).toBe('—');
  });
});
