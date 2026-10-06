import { describe, expect, it } from 'vitest';
import { montarGrade, type SaldoVariacao } from './grade';

const v = (
  cor: [string, number],
  tam: [string, number],
  n: { fisico: number; reservado: number },
  linha: [string, number] = ['Regular', 0],
): SaldoVariacao => ({
  produtoId: `${cor[0]}-${linha[0]}-${tam[0]}`,
  ativo: true,
  modelo: { id: 'm1', nome: 'Bermuda', ordem: 0 },
  cor: { nome: cor[0], hex: '#000000', ordem: cor[1] },
  linha: { nome: linha[0], ordem: linha[1] },
  tamanho: { nome: tam[0], ordem: tam[1] },
  fisico: n.fisico,
  reservado: n.reservado,
  disponivel: n.fisico - n.reservado,
});

describe('montarGrade', () => {
  it('cores nas linhas, tamanhos nas colunas, tudo na ordem do cadastro', () => {
    const [m] = montarGrade([
      v(['Preto', 1], ['M', 1], { fisico: 5, reservado: 2 }),
      v(['Azul', 0], ['P', 0], { fisico: 3, reservado: 0 }),
      v(['Preto', 1], ['P', 0], { fisico: 0, reservado: 1 }),
    ]);
    expect(m).toMatchObject({ nome: 'Bermuda', fisico: 8, reservado: 3, disponivel: 5 });
    const [l] = m.linhas;
    expect(l.tamanhos).toEqual(['P', 'M']);
    expect(l.cores.map((c) => c.nome)).toEqual(['Azul', 'Preto']);
    // Azul não tem M: célula vazia (não existe a variação)
    expect(l.cores[0].celulas[1]).toBeNull();
    expect(l.cores[1].celulas.map((c) => c?.disponivel)).toEqual([-1, 3]);
  });

  it('separa por linha (Regular / Plus Size)', () => {
    const [m] = montarGrade([
      v(['Preto', 0], ['G1', 0], { fisico: 1, reservado: 0 }, ['Plus Size', 1]),
      v(['Preto', 0], ['M', 1], { fisico: 1, reservado: 0 }),
    ]);
    expect(m.linhas.map((l) => [l.linha, l.tamanhos])).toEqual([
      ['Regular', ['M']],
      ['Plus Size', ['G1']],
    ]);
  });
});
