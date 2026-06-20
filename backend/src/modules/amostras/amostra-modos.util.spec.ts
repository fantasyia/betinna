import { describe, expect, it } from 'vitest';
import {
  AMOSTRA_MODOS_DEFAULT,
  avaliarSubsidiada,
  primeiroModoAtivo,
  resolveAmostraModos,
} from './amostra-modos.util';

describe('resolveAmostraModos', () => {
  it('sem config → defaults (subsidiada livre)', () => {
    const c = resolveAmostraModos(undefined);
    expect(c).toEqual(AMOSTRA_MODOS_DEFAULT);
    expect(c.modosAtivos.subsidiada).toBe(true);
    expect(c.exigeAprovacaoSubsidiada).toBe(false);
  });

  it('faz merge raso sobre defaults', () => {
    const c = resolveAmostraModos({
      modosAtivos: { compra_propria: true },
      exigeAprovacaoSubsidiada: true,
    });
    expect(c.modosAtivos.subsidiada).toBe(true); // default preservado
    expect(c.modosAtivos.compra_propria).toBe(true); // override
    expect(c.exigeAprovacaoSubsidiada).toBe(true);
  });
});

describe('primeiroModoAtivo', () => {
  it('respeita a ordem subsidiada → compra_propria → compra_cliente', () => {
    expect(
      primeiroModoAtivo(
        resolveAmostraModos({
          modosAtivos: { subsidiada: false, compra_propria: true, compra_cliente: true },
        }),
      ),
    ).toBe('compra_propria');
  });

  it('nenhum ativo → null', () => {
    expect(
      primeiroModoAtivo(
        resolveAmostraModos({
          modosAtivos: { subsidiada: false, compra_propria: false, compra_cliente: false },
        }),
      ),
    ).toBeNull();
  });
});

describe('avaliarSubsidiada', () => {
  it('tipo sempre + sem exigir aprovação → não precisa aprovação', () => {
    const r = avaliarSubsidiada(resolveAmostraModos({}), null);
    expect(r).toEqual({ precisaAprovacao: false, elegivel: true });
  });

  it('exigeAprovacaoSubsidiada → sempre precisa, mesmo elegível', () => {
    const r = avaliarSubsidiada(resolveAmostraModos({ exigeAprovacaoSubsidiada: true }), null);
    expect(r.precisaAprovacao).toBe(true);
  });

  it('media_kg_mes abaixo do mínimo → não elegível → precisa aprovação', () => {
    const cfg = resolveAmostraModos({
      elegibilidadeSubsidiada: { tipo: 'media_kg_mes', minKgMes: 250, mesesJanela: 3 },
    });
    expect(avaliarSubsidiada(cfg, 100)).toEqual({ precisaAprovacao: true, elegivel: false });
    expect(avaliarSubsidiada(cfg, 300)).toEqual({ precisaAprovacao: false, elegivel: true });
    expect(avaliarSubsidiada(cfg, 250)).toEqual({ precisaAprovacao: false, elegivel: true });
  });

  it('tipo manual → sempre não elegível (cai na fila)', () => {
    const cfg = resolveAmostraModos({
      elegibilidadeSubsidiada: { tipo: 'manual', minKgMes: 0, mesesJanela: 3 },
    });
    expect(avaliarSubsidiada(cfg, 9999).precisaAprovacao).toBe(true);
  });
});
