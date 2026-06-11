import { describe, expect, it } from 'vitest';
import { previewCron, proximaExecucaoCron } from './cron.util';

describe('previewCron', () => {
  it('valida e devolve 3 próximas execuções', () => {
    const r = previewCron('0 9 * * 1-5', 'America/Sao_Paulo');
    expect(r.valido).toBe(true);
    expect(r.proximas).toHaveLength(3);
    expect(r.proximas[0].iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.proximas[0].label).toBeTruthy();
  });

  it('expressão inválida → valido=false com erro (não lança)', () => {
    const r = previewCron('isso nao eh cron');
    expect(r.valido).toBe(false);
    expect(r.erro).toBeTruthy();
    expect(r.proximas).toHaveLength(0);
  });

  it('expressão vazia → valido=false', () => {
    expect(previewCron('').valido).toBe(false);
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
