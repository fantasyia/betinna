import { describe, expect, it } from 'vitest';
import { codigoDaProposta, numerosDosAnexos } from './numero-anexos.util';

/**
 * O cabeçalho do Anexo II pede `PT-(código)` e `PC-(código)`, e o Léo confirmou
 * em 17/09 que **é o mesmo código nos dois** — só muda o prefixo.
 *
 * 📌 Por isso isto é uma FUNÇÃO e não dois campos no banco: dois campos
 * guardando o mesmo código é exatamente como eles divergem (um é atualizado, o
 * outro fica). Derivar mantém uma verdade só.
 */
describe('números dos anexos da proposta', () => {
  it('o mesmo código nos dois anexos, só o prefixo muda', () => {
    expect(numerosDosAnexos('PROP-0042')).toEqual({
      tecnica: 'PT-0042',
      comercial: 'PC-0042',
    });
  });

  /**
   * O número circula em log, e-mail e no PDF — em algum momento alguém passa o
   * do ANEXO de volta em vez do da proposta. Idempotente, isso não vira
   * `PT-PT-0042`.
   */
  it.each(['PT-0042', 'PC-0042', 'PROP-0042'])('idempotente: %s devolve o mesmo par', (entrada) => {
    expect(numerosDosAnexos(entrada)).toEqual({ tecnica: 'PT-0042', comercial: 'PC-0042' });
  });

  it.each([
    ['PROP-0042', '0042'],
    ['PT-0042', '0042'],
    ['0042', '0042'],
    ['PROP-2026-0042', '2026-0042'],
  ])('código de %j é %j', (numero, esperado) => {
    expect(codigoDaProposta(numero)).toBe(esperado);
  });

  /** Entrada degenerada não pode virar `PT-` pelado — melhor devolver o que veio. */
  it.each(['', '   '])('entrada vazia não vira prefixo solto', (numero) => {
    const r = numerosDosAnexos(numero);
    expect(r.tecnica).toBe('PT-');
    expect(r.comercial).toBe('PC-');
  });

  /** Espaço em volta é ruído de copiar e colar, não parte do código. */
  it('ignora espaço em volta', () => {
    expect(numerosDosAnexos('  PROP-0042  ').tecnica).toBe('PT-0042');
  });
});
