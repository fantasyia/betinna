import { describe, expect, it } from 'vitest';
import { restante } from './relogio';

describe('restante (relógio da reserva)', () => {
  const fim = '2026-10-07T12:20:00.000Z';
  const t = (iso: string) => Date.parse(iso);

  it('mostra mm:ss', () => {
    expect(restante(fim, t('2026-10-07T12:00:18Z'))).toEqual({ texto: '19:42', segundos: 1182, vencido: false });
    expect(restante(fim, t('2026-10-07T12:19:55Z'))?.texto).toBe('0:05');
  });
  it('passou do prazo: zera e marca vencido (nunca negativo)', () => {
    expect(restante(fim, t('2026-10-07T12:25:00Z'))).toEqual({ texto: '0:00', segundos: 0, vencido: true });
  });
  it('sem data (empresa sem estoque próprio): null', () => {
    expect(restante(null)).toBeNull();
    expect(restante('lixo')).toBeNull();
  });
});
