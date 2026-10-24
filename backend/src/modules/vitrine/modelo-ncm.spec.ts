import { describe, expect, it } from 'vitest';
import { modeloSchema } from './vitrine.dto';
import { fiscalEmpresaSchema, fiscalProdutoSchema, limparFiscal } from './fiscal';

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

describe('fiscal do produto e da empresa (24/10)', () => {
  it('guarda só os dígitos e tira o vazio — sem valor padrão', () => {
    const r = fiscalProdutoSchema.parse({
      cest: '',
      origem: '0',
      unidade: 'pc',
      csosn: '',
      cfopDentro: '5.101',
      marca: ' Ribelt ',
      embalagemAlturaCm: 4,
    });
    expect(limparFiscal(r)).toEqual({
      origem: '0',
      unidade: 'PC',
      cfopDentro: '5101',
      marca: 'Ribelt',
      embalagemAlturaCm: 4,
    });
    expect(limparFiscal(fiscalProdutoSchema.parse({ cest: '', marca: '' }))).toBeNull();
  });

  it('recusa valor no formato errado', () => {
    expect(fiscalProdutoSchema.safeParse({ origem: '9' }).success).toBe(false);
    expect(fiscalProdutoSchema.safeParse({ cfopFora: '610' }).success).toBe(false);
    expect(fiscalEmpresaSchema.safeParse({ crt: '5' }).success).toBe(false);
    expect(fiscalEmpresaSchema.parse({ cstPisCofins: '49', csosn: '' })).toEqual({
      cstPisCofins: '49',
      csosn: null,
    });
  });
});
