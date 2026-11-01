import { describe, expect, it } from 'vitest';
import { aplicarImagens, costuraGravada, foraDaOficina, medidasForaDaGrade } from './ficha-costura';
import { costuraSchema } from './fichas.dto';

/** Ficha de costura (#03 Modelista, 01/11). */
const img = (id: string) => ({ id, path: `costura/e/ml/${id}.webp`, legenda: null });

describe('ficha de costura', () => {
  it('medida aceita número e texto ("relaxada 74 / esticada 101")', () => {
    const r = costuraSchema.safeParse({
      medidas: [{ ponto: 'Cintura', valores: { M: 74, G: 'relaxada 74 / esticada 101' } }],
    });
    expect(r.success).toBe(true);
    // O resto nasce vazio.
    expect(r.success && r.data.sequencia).toEqual([]);
  });

  it('acusa tamanho da medida que não é da grade', () => {
    const medidas = [{ ponto: 'Quadril', tolerancia: null, valores: { M: 50, XGG: 60 } }];
    expect(medidasForaDaGrade(medidas, ['P', 'M', 'G'])).toEqual(['XGG']);
  });

  it('reordena e legenda as imagens; a que sumiu da lista vai pro bucket apagar', () => {
    const r = aplicarImagens(
      [img('a'), img('b'), img('c')],
      [
        { id: 'c', legenda: 'costas' },
        { id: 'a', legenda: null },
      ],
    );
    expect(r.imagens.map((i) => [i.id, i.legenda])).toEqual([
      ['c', 'costas'],
      ['a', null],
    ]);
    expect(r.removidas).toEqual(['costura/e/ml/b.webp']);
  });

  it('imagem que não existe ESTOURA — não inventa imagem', () => {
    expect(() => aplicarImagens([img('a')], [{ id: 'zz', legenda: null }])).toThrow(/não existe/);
    expect(() =>
      aplicarImagens(
        [img('a')],
        [
          { id: 'a', legenda: null },
          { id: 'a', legenda: null },
        ],
      ),
    ).toThrow(/repetida/);
  });

  it('"NÃO é da oficina": serviço restrito leva os tamanhos; o resto vale em todos', () => {
    const servicos = [
      { id: 'passar-cordao', nome: 'Passar cordão' },
      { id: 'dobrar', nome: 'Dobrar e embalar' },
    ];
    expect(foraDaOficina(servicos, { 'passar-cordao': ['8', '10'] })).toEqual([
      { nome: 'Passar cordão', tamanhos: ['8', '10'] },
      { nome: 'Dobrar e embalar', tamanhos: null },
    ]);
    expect(foraDaOficina(servicos, null).every((s) => s.tamanhos === null)).toBe(true);
  });

  it('ficha sem costura gravada = null', () => {
    expect(costuraGravada(null)).toBeNull();
    expect(costuraGravada({ atencao: ['x'] })?.imagens).toEqual([]);
  });
});
