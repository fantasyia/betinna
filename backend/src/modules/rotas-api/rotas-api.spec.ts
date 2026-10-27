import { describe, expect, it } from 'vitest';
import { catalogo, juntarCaminho } from './rotas-api';

describe('catálogo de rotas do token "tudo" (26/10)', () => {
  it('junta prefixo e caminho sem barra dobrada', () => {
    expect(juntarCaminho('erp', 'acabamento')).toBe('/erp/acabamento');
    expect(juntarCaminho('/vitrine/admin/', '/modelos/:id')).toBe('/vitrine/admin/modelos/:id');
    expect(juntarCaminho('kits', '')).toBe('/kits');
  });

  it('esconde o que o "tudo" não alcança e filtra pelo trecho', () => {
    const rotas = [
      { metodo: 'PUT', caminho: '/erp/acabamento', resumo: 'Salva acabamento' },
      { metodo: 'POST', caminho: '/fluxos/:id/ativar', resumo: null },
      { metodo: 'POST', caminho: '/inbox/:id/responder', resumo: null },
      { metodo: 'GET', caminho: '/kits', resumo: 'Kits' },
      { metodo: 'GET', caminho: '/kits', resumo: 'Kits' },
    ];
    expect(catalogo(rotas).map((r) => `${r.metodo} ${r.caminho}`)).toEqual([
      'PUT /erp/acabamento',
      'GET /kits',
    ]);
    expect(catalogo(rotas, 'ACABAM').length).toBe(1);
  });
});
