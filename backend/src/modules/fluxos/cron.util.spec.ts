import { describe, expect, it } from 'vitest';
import {
  previewCron,
  previewCrons,
  proximaExecucaoCron,
  proximaExecucaoCrons,
  validarCronExpr,
} from './cron.util';

describe('validarCronExpr', () => {
  it('aceita expressão de 5 campos válida', () => {
    expect(validarCronExpr('0 9 * * 1-5').valido).toBe(true);
  });

  it('rejeita expressão com menos de 5 campos (bug do "2")', () => {
    const r = validarCronExpr('2');
    expect(r.valido).toBe(false);
    expect(r.erro).toContain('5 campos');
  });

  it('rejeita expressão com mais de 5 campos', () => {
    expect(validarCronExpr('0 0 9 * * 1-5').valido).toBe(false);
  });

  it('rejeita campo fora de range (5 campos, mas inválido)', () => {
    expect(validarCronExpr('75 9 * * *').valido).toBe(false);
  });

  it('vazia → inválida', () => {
    expect(validarCronExpr('').valido).toBe(false);
  });
});

describe('previewCron', () => {
  it('valida e devolve 5 próximas execuções (default novo)', () => {
    const r = previewCron('0 9 * * 1-5', 'America/Sao_Paulo');
    expect(r.valido).toBe(true);
    expect(r.proximas).toHaveLength(5);
    expect(r.proximas[0].iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.proximas[0].label).toBeTruthy();
  });

  it('expressão de 1 campo "2" → inválida (não vira segundos)', () => {
    const r = previewCron('2');
    expect(r.valido).toBe(false);
    expect(r.erro).toContain('5 campos');
    expect(r.proximas).toHaveLength(0);
  });

  it('expressão vazia → valido=false', () => {
    expect(previewCron('').valido).toBe(false);
  });
});

describe('previewCrons (múltiplas expressões)', () => {
  it('funde e ordena as próximas execuções de várias expressões', () => {
    // 09:00 e 14:00 todo dia — devem se intercalar em ordem cronológica.
    const r = previewCrons(['0 9 * * *', '0 14 * * *'], 'America/Sao_Paulo', 4);
    expect(r.valido).toBe(true);
    expect(r.proximas).toHaveLength(4);
    const ts = r.proximas.map((p) => new Date(p.iso).getTime());
    // ordenado ascendente
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('uma expressão inválida invalida o conjunto', () => {
    const r = previewCrons(['0 9 * * *', '2'], 'America/Sao_Paulo');
    expect(r.valido).toBe(false);
    expect(r.erro).toBeTruthy();
  });

  it('array vazio → inválido', () => {
    expect(previewCrons([]).valido).toBe(false);
  });
});

describe('proximaExecucaoCron', () => {
  it('calcula o próximo horário depois de uma data', () => {
    const apos = new Date('2026-06-10T12:00:00.000Z'); // qua 09:00 BRT já passou
    const prox = proximaExecucaoCron('0 9 * * 1-5', 'America/Sao_Paulo', apos);
    expect(prox).toBeInstanceOf(Date);
    expect(prox!.getTime()).toBeGreaterThan(apos.getTime());
  });

  it('inválida → null', () => {
    expect(proximaExecucaoCron('xyz', 'America/Sao_Paulo', new Date())).toBeNull();
  });
});

describe('proximaExecucaoCrons (a mais cedo)', () => {
  it('retorna a execução mais cedo entre várias expressões', () => {
    const apos = new Date('2026-06-15T11:00:00.000Z'); // 08:00 BRT
    // 09:00 e 14:00 BRT → a mais cedo depois das 08:00 é 09:00.
    const prox = proximaExecucaoCrons(['0 14 * * *', '0 9 * * *'], 'America/Sao_Paulo', apos);
    expect(prox).toBeInstanceOf(Date);
    // 09:00 BRT = 12:00 UTC
    expect(prox!.toISOString()).toBe('2026-06-15T12:00:00.000Z');
  });

  it('ignora expressões inválidas e usa as válidas', () => {
    const prox = proximaExecucaoCrons(['2', '0 9 * * *'], 'America/Sao_Paulo', new Date());
    expect(prox).toBeInstanceOf(Date);
  });

  it('todas inválidas → null', () => {
    expect(proximaExecucaoCrons(['2', 'xyz'], 'America/Sao_Paulo', new Date())).toBeNull();
  });
});
