import { describe, expect, it } from 'vitest';
import { googleTagLigada } from './google-tag.service';
import { googleTagConfigSchema } from './vitrine.dto';

/** Tag do Google da vitrine (#04/Léo, 15/10). */

describe('googleTagLigada', () => {
  it('desligada ou sem ID: a vitrine não recebe nada', () => {
    expect(googleTagLigada({})).toBeNull();
    expect(googleTagLigada({ googleTag: { ativo: false, ga4Id: 'G-ABC123' } })).toBeNull();
    expect(googleTagLigada({ googleTag: { ativo: true } })).toBeNull();
  });

  it('ligada: GA4, Ads e o send_to da compra montado', () => {
    expect(
      googleTagLigada({
        googleTag: {
          ativo: true,
          ga4Id: 'G-8XEB9JV0KH',
          adsId: 'AW-18514151629',
          compraLabel: 'WNmUCLPdqp0dEM2RnvxE',
        },
      }),
    ).toEqual({
      ga4Id: 'G-8XEB9JV0KH',
      adsId: 'AW-18514151629',
      compraSendTo: 'AW-18514151629/WNmUCLPdqp0dEM2RnvxE',
    });
  });
});

describe('googleTagConfigSchema', () => {
  it('aceita os IDs (e vazio vira null)', () => {
    const r = googleTagConfigSchema.parse({
      ativo: true,
      ga4Id: 'g-8xeb9jv0kh',
      adsId: '',
      compraLabel: '',
    });
    expect(r).toMatchObject({ ga4Id: 'G-8XEB9JV0KH', adsId: null, compraLabel: null });
  });

  it('recusa ID torto, ligar sem ID e rótulo sem Ads', () => {
    expect(googleTagConfigSchema.safeParse({ ativo: false, ga4Id: 'UA-123' }).success).toBe(false);
    expect(googleTagConfigSchema.safeParse({ ativo: true }).success).toBe(false);
    expect(
      googleTagConfigSchema.safeParse({ ativo: true, ga4Id: 'G-ABC123', compraLabel: 'abcd' })
        .success,
    ).toBe(false);
  });
});
