// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  acrescimoDoOpcional,
  baseDoOpcional,
  inicioPeloProduto,
  opcionaisDe,
  sugestoesAntesDePagar,
  type ModeloPub,
} from './calculo';
import { baseDoOpcional as baseNoServidor, sitemapXml } from '../../../server.mjs';

/** Opcional do produto (Léo, 02/11: "+ emblema emborrachado"). */

const linha = (id: string, preco: number) => ({
  id,
  linhaId: 'INF',
  nome: 'Infantil',
  tamanhos: [{ id: `${id}-t`, tamanhoId: '4', nome: '4' }],
  precoEntrada: preco,
  precoVolume: preco - 2,
  precoAtacadao: preco - 3,
  precoSugerido: null,
  tabelaMedidas: null,
});
const modelo = (id: string, extra: Partial<ModeloPub> = {}): ModeloPub => ({
  id,
  nome: id,
  slug: id,
  categoria: null,
  descricao: null,
  etiquetas: [],
  tituloMarketplace: null,
  descricaoMarketplace: null,
  composicao: null,
  cores: [{ id: `${id}-preto`, corId: 'PRETO', nome: 'Preto', hex: '#000', fotos: [] }],
  linhas: [linha(`${id}-inf`, 18.99)],
  videos: [],
  ...extra,
});

const uv = modelo('uv', { opcionais: [{ modeloId: 'uv-emb', nome: 'emblema emborrachado' }] });
const uvEmb = modelo('uv-emb', {
  opcionalDeId: 'uv',
  opcionalNome: 'emblema emborrachado',
  linhas: [linha('uv-emb-inf', 28.99)],
});
const bermuda = modelo('bermuda');
const v = { modelos: [uv, uvEmb, bermuda], linhas: [{ id: 'INF', nome: 'Infantil', selo: null }] };

describe('opcional do produto', () => {
  it('o opcional sabe o base, e o base lista o opcional', () => {
    expect(baseDoOpcional(uvEmb, v)).toBe(uv);
    expect(baseDoOpcional(uv, v)).toBeNull();
    expect(opcionaisDe(uv, v)).toEqual([uvEmb]);
  });

  it('sem o base publicado, o opcional volta a ser produto normal', () => {
    expect(baseDoOpcional(uvEmb, { modelos: [uvEmb] })).toBeNull();
  });

  it('acréscimo por peça na faixa: +R$ 10 na entrada', () => {
    expect(acrescimoDoOpcional(uv, uvEmb, 'INF')).toBe(10);
    expect(acrescimoDoOpcional(uv, uvEmb, 'INF', 'atacadao')).toBe(10);
    expect(acrescimoDoOpcional(uv, uvEmb, 'REG')).toBeNull();
  });

  it('o link do opcional abre o BASE com a escolha marcada', () => {
    const i = inicioPeloProduto(v, 'uv-emb', '?cor=preto');
    expect(i?.modelo.id).toBe('uv');
    expect(i?.opcionalId).toBe('uv-emb');
  });

  it('?opcional= no link do base também marca; opcional de outro é ignorado', () => {
    expect(inicioPeloProduto(v, 'uv', '?opcional=uv-emb')?.opcionalId).toBe('uv-emb');
    expect(inicioPeloProduto(v, 'bermuda', '?opcional=uv-emb')?.opcionalId).toBeNull();
    expect(inicioPeloProduto(v, 'uv', '')?.opcionalId).toBeNull();
  });

  it('o opcional não é sugerido sozinho antes de pagar', () => {
    const c = { bermuda: { 'bermuda-preto': { 'bermuda-inf-t': 12 } } };
    expect(sugestoesAntesDePagar(v, c).map((m) => m.id)).toEqual(['uv']);
  });

  it('servidor: opcional fica fora do sitemap e aponta pro base', () => {
    const xml = sitemapXml(v, 'https://atacado.ribelt.com.br');
    expect(xml).toContain('/p/uv<');
    expect(xml).not.toContain('/p/uv-emb');
    expect(baseNoServidor(uvEmb, v)?.id).toBe('uv');
    expect(baseNoServidor(bermuda, v)).toBeNull();
  });
});
