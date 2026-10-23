import { describe, expect, it } from 'vitest';
import { slugDoNome, slugLivre } from './slug-modelo';

describe('slug do produto (/p/<slug>, 23/10)', () => {
  it('sem acento, minúsculo, hífen', () => {
    expect(slugDoNome('Blusão Moletom Canguru com Capuz')).toBe('blusao-moletom-canguru-com-capuz');
    expect(slugDoNome('Calça Tactel com Zíper nos bolsos')).toBe(
      'calca-tactel-com-ziper-nos-bolsos',
    );
    expect(slugDoNome('  ***  ')).toBe('produto');
  });

  it('repetido na empresa ganha -2, -3', () => {
    const usados = new Set(['camiseta-uv']);
    expect(slugLivre('Camiseta UV', usados)).toBe('camiseta-uv-2');
    usados.add('camiseta-uv-2');
    expect(slugLivre('Camiseta UV', usados)).toBe('camiseta-uv-3');
  });
});

describe('renomear muda o endereço e guarda o antigo (Léo, 23/10)', () => {
  it('slugAoRenomear: novo do nome, antigo vai pra slugsAntigos, sem pegar o de outro modelo', async () => {
    const { VitrineAdminService } = await import('./vitrine-admin.service');
    const svc = Object.create(VitrineAdminService.prototype) as { slugAoRenomear: Function };
    const tx = {
      catalogoModelo: {
        findUnique: async () => ({ slug: 'bermuda-moletom-summer', slugsAntigos: [] }),
        findMany: async () => [{ slug: 'bermuda-de-moletom', slugsAntigos: [] }],
      },
    };
    const r = await svc.slugAoRenomear(tx, 'e1', 'm1', 'Bermuda de Moletom');
    expect(r).toEqual({ slug: 'bermuda-de-moletom-2', slugsAntigos: ['bermuda-moletom-summer'] });
    const igual = await svc.slugAoRenomear(tx, 'e1', 'm1', 'Bermuda Moletom Summer');
    expect(igual).toEqual({});
  });
});
