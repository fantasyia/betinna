import { describe, expect, it } from 'vitest';
import { clarityConfigSchema, clarityLigado } from './clarity';
import { politicaDePrivacidade, type DadosPolitica } from './privacidade';

describe('Microsoft Clarity (22/10)', () => {
  it('só liga com ativo E ID', () => {
    expect(clarityLigado({ clarity: { ativo: true, projetoId: 'z1z4fnaulg' } })).toEqual({
      projetoId: 'z1z4fnaulg',
    });
    expect(clarityLigado({ clarity: { ativo: false, projetoId: 'z1z4fnaulg' } })).toBeNull();
    expect(clarityLigado({ clarity: { ativo: true } })).toBeNull();
    expect(clarityLigado(null)).toBeNull();
  });

  it('valida o ID; ligar sem ID é recusado', () => {
    expect(clarityConfigSchema.parse({ ativo: true, projetoId: ' Z1Z4FNAULG ' }).projetoId).toBe(
      'z1z4fnaulg',
    );
    expect(clarityConfigSchema.safeParse({ ativo: true, projetoId: '' }).success).toBe(false);
    expect(clarityConfigSchema.safeParse({ ativo: true, projetoId: '<script>' }).success).toBe(
      false,
    );
    expect(clarityConfigSchema.safeParse({ ativo: false, projetoId: '' }).success).toBe(true);
  });

  it('a política de privacidade cita o Clarity só quando ele está ligado', () => {
    const base: DadosPolitica = {
      controlador: 'X Ltda',
      marca: 'X',
      cnpj: null,
      cidade: null,
      uf: null,
      email: 'p@x.com',
      atualizadaEm: '2026-10-22',
      usa: { pagamentoOnline: false, frete: false, assistenteIa: false },
    };
    const texto = (d: DadosPolitica) =>
      politicaDePrivacidade(d)
        .secoes.flatMap((s) => [...s.paragrafos, ...(s.itens ?? [])])
        .join('\n');
    expect(texto(base)).not.toMatch(/Clarity/);
    const t = texto({ ...base, usa: { ...base.usa, clarity: true } });
    expect(t).toMatch(/Microsoft \(Clarity\)/);
    expect(t).toMatch(/mascarados/);
  });
});
