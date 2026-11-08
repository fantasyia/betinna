import { describe, expect, it } from 'vitest';
import { seloRaConfigSchema, seloRaLigado } from './selo-reclame-aqui';

const ID = 'czczbGExcXVsdWJOUmxsZzpyaWJlbHQtY29uZmVjY29lcw==';

describe('selo do Reclame Aqui (07/11)', () => {
  it('ligado com data-id: a vitrine recebe id e modelo', () => {
    expect(
      seloRaLigado({ seloReclameAqui: { ativo: true, dataId: ID, modelo: 'horizontal_3' } }),
    ).toEqual({ dataId: ID, modelo: 'horizontal_3' });
  });

  it('desligado, sem id, id estranho ou modelo desconhecido', () => {
    expect(seloRaLigado({ seloReclameAqui: { ativo: false, dataId: ID } })).toBeNull();
    expect(seloRaLigado({ seloReclameAqui: { ativo: true, dataId: null } })).toBeNull();
    expect(seloRaLigado({ seloReclameAqui: { ativo: true, dataId: '"><script>' } })).toBeNull();
    expect(
      seloRaLigado({ seloReclameAqui: { ativo: true, dataId: ID, modelo: 'gigante' } }),
    ).toEqual({ dataId: ID, modelo: 'compact_1' });
    expect(seloRaLigado({})).toBeNull();
  });

  it('schema: ligar exige data-id; modelo fora da lista é recusado', () => {
    expect(seloRaConfigSchema.safeParse({ ativo: true, dataId: '' }).success).toBe(false);
    expect(
      seloRaConfigSchema.safeParse({ ativo: true, dataId: ID, modelo: 'gigante' }).success,
    ).toBe(false);
    expect(seloRaConfigSchema.parse({ ativo: true, dataId: ID })).toMatchObject({
      modelo: 'compact_1',
    });
  });
});
