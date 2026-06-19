import { describe, it, expect } from 'vitest';
import { feriadosNacionaisDoAno, ehFeriadoNacional } from './feriados.util';

describe('feriadosNacionaisDoAno', () => {
  it('inclui os feriados fixos federais', () => {
    const set = feriadosNacionaisDoAno(2026);
    for (const f of ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25']) {
      expect(set.has(f)).toBe(true);
    }
  });

  it('Consciência Negra (11-20) só a partir de 2024', () => {
    expect(feriadosNacionaisDoAno(2026).has('11-20')).toBe(true);
    expect(feriadosNacionaisDoAno(2023).has('11-20')).toBe(false);
  });

  it('calcula os móveis (Páscoa 2025 = 20/abr)', () => {
    const set = feriadosNacionaisDoAno(2025);
    expect(set.has('04-18')).toBe(true); // Sexta-feira Santa
    expect(set.has('03-03')).toBe(true); // Carnaval segunda
    expect(set.has('03-04')).toBe(true); // Carnaval terça
    expect(set.has('06-19')).toBe(true); // Corpus Christi
  });

  it('dia comum não é feriado', () => {
    expect(feriadosNacionaisDoAno(2026).has('06-20')).toBe(false);
  });
});

describe('ehFeriadoNacional (com fuso)', () => {
  it('Natal no fuso BR', () => {
    const d = new Date('2026-12-25T12:00:00Z'); // 09:00 BRT, 25/12
    expect(ehFeriadoNacional(d, 'America/Sao_Paulo')).toBe(true);
  });

  it('respeita o fuso na virada do dia', () => {
    // 01:00 UTC de 01/01 = 22:00 BRT de 31/12 (não é feriado nesse fuso).
    const d = new Date('2026-01-01T01:00:00Z');
    expect(ehFeriadoNacional(d, 'America/Sao_Paulo')).toBe(false);
    // mesmo instante em UTC já é 01/01 (Confraternização).
    expect(ehFeriadoNacional(d, 'UTC')).toBe(true);
  });

  it('dia útil comum → false', () => {
    const d = new Date('2026-06-19T12:00:00Z');
    expect(ehFeriadoNacional(d, 'America/Sao_Paulo')).toBe(false);
  });
});
