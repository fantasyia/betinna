import { describe, expect, it } from 'vitest';
import { apareceNaVitrine, pendenciasDoModelo } from './pendencias';
import type { Modelo } from './tipos';

const cor = (nome: string, fotos = 1) => ({
  id: `mc-${nome}`,
  corId: `c-${nome}`,
  ordem: 0,
  cor: { id: `c-${nome}`, nome, hex: '#000000', ordem: 0, ativo: true },
  fotos: Array.from({ length: fotos }, (_, i) => ({
    id: `f-${nome}-${i}`,
    ordem: i,
    url: 'u',
    thumbUrl: 't',
    largura: 1,
    altura: 1,
  })),
});

const linha = (nome: string, entrada: number | null, sugerido: number | null) => ({
  id: `ml-${nome}`,
  linhaId: `l-${nome}`,
  precoEntrada: entrada,
  precoVolume: null,
  precoAtacadao: null,
  precoSugerido: sugerido,
  tabelaMedidas: null,
  linha: { id: `l-${nome}`, nome, ordem: 0, ativo: true, tamanhos: [] },
  tamanhos: [],
});

const completo = (): Modelo => ({
  id: 'm1',
  nome: 'Moletom',
  categoriaId: 'cat',
  categoria: { id: 'cat', nome: 'Moletom' },
  descricao: null,
  etiquetas: [],
  ordem: 0,
  ativo: true,
  tituloMarketplace: 'Moletom canguru',
  descricaoMarketplace: 'Desc',
  composicao: null,
  cores: [cor('Preto')],
  linhas: [linha('Regular', 45, 89.9)],
  videos: [],
  variacoes: [],
});

describe('pendenciasDoModelo', () => {
  it('modelo completo: nenhuma pendência, aparece na vitrine', () => {
    expect(pendenciasDoModelo(completo())).toEqual([]);
    expect(apareceNaVitrine(completo())).toBe(true);
  });

  it('o caso do Léo (06/10): 6 cores, sem grade e sem foto → NÃO aparece', () => {
    const m = { ...completo(), cores: ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => cor(n, 0)), linhas: [] };
    const p = pendenciasDoModelo(m);
    expect(p.filter((x) => x.nivel === 'bloqueia').map((x) => x.texto)).toEqual([
      'Sem nenhuma foto',
      'Sem grade (linha e tamanhos)',
    ]);
    expect(apareceNaVitrine(m)).toBe(false);
  });

  it('cor sem foto é AVISO (as outras cores aparecem), com o nome da cor', () => {
    const m = { ...completo(), cores: [cor('Preto'), cor('Bege', 0)] };
    expect(pendenciasDoModelo(m)).toEqual([
      { nivel: 'aviso', texto: '1 cor(es) sem foto: Bege', aba: 'cores' },
    ]);
    expect(apareceNaVitrine(m)).toBe(true);
  });

  it('preço vazio é aviso "sob consulta"; sem sugerido avisa que não mostra lucro', () => {
    const m = { ...completo(), linhas: [linha('Regular', null, null)] };
    const textos = pendenciasDoModelo(m).map((x) => x.texto);
    expect(textos).toContain('Preço sob consulta em: Regular');
    expect(textos).toContain('Sem revenda sugerida (não mostra o lucro): Regular');
  });

  it('inativo bloqueia', () => {
    expect(apareceNaVitrine({ ...completo(), ativo: false })).toBe(false);
  });
});
