import { describe, expect, it } from 'vitest';
import {
  itensParaEnvio,
  mascararWhatsapp,
  faixaDoTotal,
  limparCarrinho,
  lucroPorPeca,
  nomeArquivo,
  precoNaFaixa,
  proximaFaixa,
  resumoPedido,
  somar,
  textoKit,
  totalPecas,
  type Carrinho,
  type LinhaPub,
  type ModeloPub,
  type VitrinePub,
} from './calculo';

const faixas = { minimoEntrada: 5, minimoVolume: 50, minimoAtacadao: 500 };

const linha = (over: Partial<LinhaPub> = {}): LinhaPub => ({
  id: 'ml-reg',
  linhaId: 'lin-reg',
  nome: 'Regular',
  tamanhos: [
    { id: 't-p', nome: 'P' },
    { id: 't-m', nome: 'M' },
  ],
  precoEntrada: 45,
  precoVolume: 40,
  precoAtacadao: 36,
  precoSugerido: 89.9,
  tabelaMedidas: null,
  ...over,
});

const modelo = (over: Partial<ModeloPub> = {}): ModeloPub => ({
  id: 'mod-1',
  nome: 'Bermuda Moletom Summer',
  categoria: { id: 'cat', nome: 'Moletom' },
  descricao: 'Bermuda leve',
  etiquetas: ['Gramatura 200'],
  tituloMarketplace: 'Bermuda Moletom Masculina Summer',
  descricaoMarketplace: 'Bermuda de moletom leve.',
  composicao: '50% algodão, 50% poliéster',
  cores: [
    { id: 'mc-preto', nome: 'Preto', hex: '#000', fotos: [{ url: 'u', thumbUrl: 't', largura: 1, altura: 1 }] },
    { id: 'mc-bege', nome: 'Bege', hex: '#ccb', fotos: [{ url: 'u', thumbUrl: 't', largura: 1, altura: 1 }] },
  ],
  linhas: [linha()],
  videos: [],
  ...over,
});

const vitrine = (modelos = [modelo()]): VitrinePub => ({
  empresa: { nome: 'Ribelt', logoUrl: null },
  faixas,
  linhas: [{ id: 'lin-reg', nome: 'Regular' }],
  modelos,
});

describe('faixa e preço', () => {
  it('faixa pelo TOTAL de peças', () => {
    expect(faixaDoTotal(4, faixas)).toBe('entrada');
    expect(faixaDoTotal(49, faixas)).toBe('entrada');
    expect(faixaDoTotal(50, faixas)).toBe('volume');
    expect(faixaDoTotal(500, faixas)).toBe('atacadao');
  });

  it('faixa melhor sem preço usa a de baixo — nunca fica mais caro nem "sob consulta" à toa', () => {
    const l = linha({ precoVolume: null, precoAtacadao: null });
    expect(precoNaFaixa(l, 'atacadao')).toBe(45);
    expect(precoNaFaixa(linha({ precoAtacadao: null }), 'atacadao')).toBe(40);
  });

  it('sem preço de Entrada = sob consulta (null)', () => {
    expect(precoNaFaixa(linha({ precoEntrada: null, precoVolume: null, precoAtacadao: null }), 'entrada')).toBeNull();
  });

  it('lucro por peça e % sobre o custo', () => {
    expect(lucroPorPeca(45, 89.9)).toEqual({ lucro: 44.9, pct: 100 });
    expect(lucroPorPeca(null, 89.9)).toBeNull();
    expect(lucroPorPeca(45, null)).toBeNull();
  });

  it('próxima faixa e quanto falta', () => {
    expect(proximaFaixa(10, faixas)).toEqual({ faixa: 'volume', faltam: 40 });
    expect(proximaFaixa(120, faixas)).toEqual({ faixa: 'atacadao', faltam: 380 });
    expect(proximaFaixa(500, faixas)).toBeNull();
  });
});

describe('carrinho', () => {
  it('somar acumula, não fica negativo e limpa o que zerou', () => {
    let c: Carrinho = {};
    c = somar(c, 'mod-1', 'mc-preto', 't-p', 6);
    c = somar(c, 'mod-1', 'mc-preto', 't-p', 6);
    expect(c['mod-1']['mc-preto']['t-p']).toBe(12);
    c = somar(c, 'mod-1', 'mc-preto', 't-p', -50);
    expect(c).toEqual({});
  });

  it('carrinho salvo é limpo do que saiu da vitrine (cor, tamanho ou modelo removidos)', () => {
    const salvo: Carrinho = {
      'mod-1': { 'mc-preto': { 't-p': 3, 't-sumiu': 2 }, 'mc-sumiu': { 't-p': 1 } },
      'mod-sumiu': { x: { y: 9 } },
    };
    expect(limparCarrinho(salvo, vitrine())).toEqual({ 'mod-1': { 'mc-preto': { 't-p': 3 } } });
  });
});

describe('resumo do pedido', () => {
  it('soma todas as cores e linhas na faixa do TOTAL', () => {
    let c: Carrinho = {};
    c = somar(c, 'mod-1', 'mc-preto', 't-p', 30);
    c = somar(c, 'mod-1', 'mc-bege', 't-m', 20); // 50 peças → Volume (R$ 40)
    const r = resumoPedido(c, vitrine());
    expect(totalPecas(c)).toBe(50);
    expect(r.faixa).toBe('volume');
    expect(r.investe).toBe(2000);
    expect(r.revende).toBe(4495);
    expect(r.lucro).toBe(2495);
    expect(r.aConfirmar).toBe(false);
    expect(r.faltamMinimo).toBe(0);
  });

  it('item sem preço → total "a confirmar" e sem lucro; abaixo do mínimo avisa', () => {
    const v = vitrine([modelo({ linhas: [linha({ precoEntrada: null, precoVolume: null, precoAtacadao: null })] })]);
    const c = somar({}, 'mod-1', 'mc-preto', 't-p', 2);
    const r = resumoPedido(c, v);
    expect(r.aConfirmar).toBe(true);
    expect(r.lucro).toBeNull();
    expect(r.faltamMinimo).toBe(3);
  });
});

describe('kit pra anunciar', () => {
  it('texto com título, descrição, ficha, tamanhos, medidas e cores', () => {
    const t = textoKit(
      modelo({
        linhas: [
          linha({
            tabelaMedidas: { colunas: ['Cintura', 'Comprimento'], linhas: [{ tamanho: 'P', valores: ['38', '45'] }] },
          }),
        ],
      }),
    );
    expect(t).toContain('TÍTULO SUGERIDO\nBermuda Moletom Masculina Summer');
    expect(t).toContain('Composição: 50% algodão, 50% poliéster');
    expect(t).toContain('Regular: P, M');
    expect(t).toContain('P: Cintura 38 · Comprimento 45');
    expect(t).toContain('CORES\nPreto, Bege');
  });

  it('sem título do marketplace cai pro nome do modelo', () => {
    expect(textoKit(modelo({ tituloMarketplace: null }))).toContain('TÍTULO SUGERIDO\nBermuda Moletom Summer');
  });

  it('nome de arquivo sem acento nem caractere estranho', () => {
    expect(nomeArquivo('Cinza Mescla 12%')).toBe('Cinza-Mescla-12');
    expect(nomeArquivo('Verde-Militar ç/ã')).toBe('Verde-Militar-ca');
    expect(nomeArquivo('///')).toBe('arquivo');
  });
});

describe('envio do pedido', () => {
  it('achata o carrinho em célula + quantidade, sem preço', () => {
    const c = { m1: { c1: { p: 3, m: 2 } }, m2: { c9: { g: 1 } } };
    expect(itensParaEnvio(c)).toEqual([
      { corId: 'c1', tamanhoId: 'p', quantidade: 3 },
      { corId: 'c1', tamanhoId: 'm', quantidade: 2 },
      { corId: 'c9', tamanhoId: 'g', quantidade: 1 },
    ]);
  });
  it('máscara do WhatsApp', () => {
    expect(mascararWhatsapp('47999991234')).toBe('(47) 99999-1234');
    expect(mascararWhatsapp('4733331234')).toBe('(47) 3333-1234');
    expect(mascararWhatsapp('47')).toBe('47');
  });
});
