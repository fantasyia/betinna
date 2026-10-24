import { describe, expect, it } from 'vitest';
import { modeloSchema } from './vitrine.dto';

const ncm = (v: unknown) => modeloSchema.safeParse({ nome: 'Bermuda', ncm: v });

describe('NCM do produto (24/10)', () => {
  it('grava só os 8 dígitos (com pontos a SEFAZ recusa a nota)', () => {
    const r = ncm('6103.42.00');
    expect(r.success && r.data.ncm).toBe('61034200');
  });

  it('vazio vira null; ausente não mexe', () => {
    const r = ncm('');
    expect(r.success && r.data.ncm).toBeNull();
    const a = modeloSchema.safeParse({ nome: 'Bermuda' });
    expect(a.success && a.data.ncm).toBeUndefined();
  });

  it('recusa NCM que não tem 8 dígitos', () => {
    expect(ncm('6103.42').success).toBe(false);
  });
});
