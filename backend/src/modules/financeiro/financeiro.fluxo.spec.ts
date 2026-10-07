import { describe, expect, it } from 'vitest';
import { chaveContato, montarFluxo, periodos } from './financeiro.fluxo';
import { dataPura } from './financeiro.regras';

const d = dataPura;

describe('fluxo de caixa — períodos', () => {
  it('semana começa na segunda e cobre o intervalo inteiro', () => {
    // 07/10/2026 é quarta → semana de 05/10 (seg) a 11/10 (dom)
    const p = periodos(d('2026-10-07'), d('2026-10-20'), 'semana');
    expect(p.map((x) => x.rotulo)).toEqual(['05/10 a 11/10', '12/10 a 18/10', '19/10 a 25/10']);
  });

  it('mês: do dia 1 ao último dia, rótulo curto', () => {
    const p = periodos(d('2026-10-15'), d('2026-12-01'), 'mes');
    expect(
      p.map((x) => [
        x.rotulo,
        x.inicio.toISOString().slice(0, 10),
        x.fim.toISOString().slice(0, 10),
      ]),
    ).toEqual([
      ['out/26', '2026-10-01', '2026-10-31'],
      ['nov/26', '2026-11-01', '2026-11-30'],
      ['dez/26', '2026-12-01', '2026-12-31'],
    ]);
  });
});

describe('fluxo de caixa — realizado, previsto e saldo projetado', () => {
  const base = {
    de: '2026-10-01',
    ate: '2026-10-31',
    agrupar: 'semana' as const,
    hoje: d('2026-10-07'),
    saldoAtualC: 100_000, // R$ 1.000,00 nas contas hoje
  };

  it('realizado pela data da baixa; previsto só de hoje pra frente; vencido à parte', () => {
    const r = montarFluxo({
      ...base,
      movimentos: [
        { tipo: 'RECEBER', valorC: 50_000, data: d('2026-10-02') }, // semana 28/09
        { tipo: 'PAGAR', valorC: 20_000, data: d('2026-10-06') }, // semana 05/10
      ],
      abertos: [
        { tipo: 'RECEBER', faltaC: 30_000, vencimento: d('2026-10-03') }, // venceu → vencidos
        { tipo: 'PAGAR', faltaC: 10_000, vencimento: d('2026-10-01') }, // venceu → vencidos
        { tipo: 'RECEBER', faltaC: 40_000, vencimento: d('2026-10-09') }, // semana 05/10
        { tipo: 'PAGAR', faltaC: 25_000, vencimento: d('2026-10-14') }, // semana 12/10
      ],
    });
    expect(r.vencidos).toEqual({ aReceberC: 30_000, aPagarC: 10_000 });
    const [s1, s2, s3] = r.linhas;
    expect(s1).toMatchObject({
      rotulo: '28/09 a 04/10',
      entrouC: 50_000,
      aEntrarC: 0,
      saldoProjetadoC: null,
    });
    expect(s2).toMatchObject({
      rotulo: '05/10 a 11/10',
      atual: true,
      saiuC: 20_000,
      aEntrarC: 40_000,
    });
    // saldo atual 1.000 + 400 a entrar nesta semana
    expect(s2.saldoProjetadoC).toBe(140_000);
    // − 250 a pagar na semana seguinte
    expect(s3.saldoProjetadoC).toBe(115_000);
    expect(r.linhas.at(-1)?.saldoProjetadoC).toBe(115_000);
  });

  it('confere o critério de aceite: saldo atual + previsto − previsto = projetado', () => {
    const r = montarFluxo({
      ...base,
      agrupar: 'mes',
      movimentos: [],
      abertos: [
        { tipo: 'RECEBER', faltaC: 12_345, vencimento: d('2026-10-20') },
        { tipo: 'PAGAR', faltaC: 2_345, vencimento: d('2026-10-25') },
      ],
    });
    expect(r.linhas[0].saldoProjetadoC).toBe(100_000 + 12_345 - 2_345);
  });
});

describe('contato', () => {
  it('agrupa nome com espaço e caixa diferentes', () => {
    expect(chaveContato('  Facção  Maria ')).toBe(chaveContato('facção maria'));
    expect(chaveContato(null)).toBe('');
  });
});
