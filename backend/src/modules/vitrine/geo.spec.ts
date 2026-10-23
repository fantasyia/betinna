import { describe, expect, it } from 'vitest';
import { configGeo, geoConfigSchema } from './geo';

describe('conteúdo pros robôs das IAs (GEO, 23/10)', () => {
  it('lê a config e descarta item torto', () => {
    const g = configGeo({
      geo: {
        titulo: '  Ribelt Têxtil  ',
        faq: [{ pergunta: 'Mínimo?', resposta: '50 peças' }, { pergunta: 1 }],
        redes: ['https://www.instagram.com/_ribelt', 3],
      },
    });
    expect(g.titulo).toBe('Ribelt Têxtil');
    expect(g.faq).toHaveLength(1);
    expect(g.redes).toEqual(['https://www.instagram.com/_ribelt']);
    expect(configGeo(null)).toEqual({ titulo: null, sobre: null, faq: [], redes: [] });
  });

  it('rede tem que ser URL', () => {
    expect(geoConfigSchema.safeParse({ redes: ['@_ribelt'] }).success).toBe(false);
  });
});
