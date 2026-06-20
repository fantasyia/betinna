import { describe, expect, it } from 'vitest';
import { avaliarPedidoMinimo } from './pedido-minimo.util';

const totais = (valor: number, peso: number, quantidade: number) => ({ valor, peso, quantidade });

describe('avaliarPedidoMinimo', () => {
  it('sem regra → ok (backward-compat)', () => {
    expect(avaliarPedidoMinimo(undefined, totais(0, 0, 0)).ok).toBe(true);
    expect(avaliarPedidoMinimo(null, totais(0, 0, 0)).ok).toBe(true);
  });

  it('sem_minimo → ok mesmo com pedido vazio', () => {
    const r = avaliarPedidoMinimo({ tipo: 'sem_minimo', pesoMin: 250 }, totais(0, 0, 0));
    expect(r.ok).toBe(true);
    expect(r.tipo).toBe('sem_minimo');
  });

  it('tipo setado mas sem limite configurado → ok', () => {
    expect(avaliarPedidoMinimo({ tipo: 'por_peso' }, totais(0, 0, 0)).ok).toBe(true);
  });

  it('por_peso abaixo → não ok, com falta calculada', () => {
    const r = avaliarPedidoMinimo({ tipo: 'por_peso', pesoMin: 250 }, totais(9999, 200, 999));
    expect(r.ok).toBe(false);
    expect(r.faltas).toEqual([{ criterio: 'peso', minimo: 250, atual: 200, falta: 50 }]);
    expect(r.mensagem).toContain('50');
    expect(r.mensagem).toContain('250');
  });

  it('por_peso no limite exato → ok', () => {
    expect(avaliarPedidoMinimo({ tipo: 'por_peso', pesoMin: 250 }, totais(0, 250, 0)).ok).toBe(
      true,
    );
  });

  it('por_valor abaixo → não ok', () => {
    const r = avaliarPedidoMinimo({ tipo: 'por_valor', valorMin: 5000 }, totais(4000, 0, 0));
    expect(r.ok).toBe(false);
    expect(r.faltas[0]).toMatchObject({ criterio: 'valor', falta: 1000 });
  });

  it('por_quantidade acima → ok', () => {
    expect(
      avaliarPedidoMinimo({ tipo: 'por_quantidade', quantidadeMin: 10 }, totais(0, 0, 12)).ok,
    ).toBe(true);
  });

  it('combinada E → exige todos os limites setados', () => {
    const regra = { tipo: 'combinada' as const, valorMin: 5000, pesoMin: 250, modo: 'E' as const };
    expect(avaliarPedidoMinimo(regra, totais(5000, 250, 0)).ok).toBe(true);
    const r = avaliarPedidoMinimo(regra, totais(5000, 200, 0));
    expect(r.ok).toBe(false);
    expect(r.faltas.map((f) => f.criterio)).toEqual(['peso']);
  });

  it('combinada OU → basta um limite atendido', () => {
    const regra = { tipo: 'combinada' as const, valorMin: 5000, pesoMin: 250, modo: 'OU' as const };
    expect(avaliarPedidoMinimo(regra, totais(5000, 10, 0)).ok).toBe(true);
    expect(avaliarPedidoMinimo(regra, totais(10, 250, 0)).ok).toBe(true);
    const r = avaliarPedidoMinimo(regra, totais(10, 10, 0));
    expect(r.ok).toBe(false);
    expect(r.mensagem).toContain('OU');
  });

  it('combinada sem modo → default E', () => {
    const regra = { tipo: 'combinada' as const, valorMin: 5000, pesoMin: 250 };
    expect(avaliarPedidoMinimo(regra, totais(5000, 200, 0)).ok).toBe(false);
  });
});
