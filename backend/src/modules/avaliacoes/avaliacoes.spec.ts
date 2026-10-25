import { describe, expect, it } from 'vitest';
import {
  candidata,
  chaveModelo,
  coresDaVariacao,
  lerTriagem,
  modeloDoAnuncio,
  textoLimpo,
} from './avaliacoes';

describe('avaliações da Shopee na vitrine (25/10)', () => {
  it('título do anúncio → produto do site', () => {
    const m = (t: string) => {
      const r = modeloDoAnuncio(t);
      return r ? chaveModelo(r) : null;
    };
    expect(m('Kit 2 Bermudas de Moletom Shorts Academia Treino Masculino')).toBe(
      chaveModelo('Bermuda de Moletom'),
    );
    expect(m('Kit 2 Calças de Moletom Grosso Flanelado')).toBe(chaveModelo('Calça de Moletom'));
    expect(m('kit 6 Camisas Térmica Masculina Manga curta Proteção Uv 50+')).toBe(
      chaveModelo('Camiseta UV Manga Curta'),
    );
    expect(m("Shorts Surf Com Ziper Masculino Bermuda d'água Praia Tactel")).toBe(
      chaveModelo('Shorts Tactel com Zíper'),
    );
    expect(m('Boné aba reta')).toBeNull();
  });

  it('cores da variação: todas precisam existir no produto do site', () => {
    const bermuda = ['Preto', 'Cinza-Claro', 'Cinza-Escuro', 'Bege', 'Verde-Militar'];
    expect(coresDaVariacao('Preto/Verde Militar', bermuda)).toEqual(['Preto', 'Verde-Militar']);
    expect(coresDaVariacao('Preto + Chumbo', bermuda)).toEqual(['Preto', 'Cinza-Escuro']);
    expect(coresDaVariacao('Preto/Azul Marinho', bermuda)).toBeNull(); // bermuda não tem marinho no site
    expect(coresDaVariacao('Preto/Vinho', bermuda)).toBeNull();
  });

  it('texto: nada de marketplace, loja, entrega ou embalagem', () => {
    expect(textoLimpo('Tecido ótimo, veste muito bem')).toBe(true);
    expect(textoLimpo('Chegou rápido, recomendo')).toBe(false);
    expect(textoLimpo('Comprei na Shopee e amei')).toBe(false);
    expect(textoLimpo('Ótima loja')).toBe(false);
    expect(textoLimpo('ok')).toBe(false);
  });

  it('candidata: 5 estrelas + foto + texto limpo + não oculta', () => {
    expect(candidata({ estrelas: 5, texto: 'Ficou perfeita', fotos: ['a'] })).toBe(true);
    expect(candidata({ estrelas: 4, texto: 'Ficou perfeita', fotos: ['a'] })).toBe(false);
    expect(candidata({ estrelas: 5, texto: 'Ficou perfeita', fotos: [] })).toBe(false);
    expect(candidata({ estrelas: 5, texto: 'Ficou perfeita', fotos: ['a'], oculta: true })).toBe(
      false,
    );
  });

  it('triagem ilegível não publica', () => {
    expect(lerTriagem('{"aprovar":true,"motivo":"peça vestida"}')).toEqual({
      aprovar: true,
      motivo: 'peça vestida',
    });
    expect(lerTriagem('lixo').aprovar).toBe(false);
    expect(lerTriagem('{"aprovar":"sim"}').aprovar).toBe(false);
  });
});
