import { describe, expect, it } from 'vitest';
import {
  corDaBolinha,
  corInicial,
  corTemEstoque,
  coresPorEstoque,
  temLinha,
  fotosDaLinha,
  disponivelDe,
  itensParaEnvio,
  mascararWhatsapp,
  faixaDoTotal,
  limparCarrinho,
  lucroNaProximaFaixa,
  lucroPorPeca,
  nomeArquivo,
  precoNaFaixa,
  precosPorFaixa,
  progressoFaixa,
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
    {
      id: 'mc-preto',
      nome: 'Preto',
      hex: '#000',
      fotos: [{ url: 'u', thumbUrl: 't', largura: 1, altura: 1 }],
    },
    {
      id: 'mc-bege',
      nome: 'Bege',
      hex: '#ccb',
      fotos: [{ url: 'u', thumbUrl: 't', largura: 1, altura: 1 }],
    },
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
    expect(
      precoNaFaixa(
        linha({ precoEntrada: null, precoVolume: null, precoAtacadao: null }),
        'entrada',
      ),
    ).toBeNull();
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
    const v = vitrine([
      modelo({ linhas: [linha({ precoEntrada: null, precoVolume: null, precoAtacadao: null })] }),
    ]);
    const c = somar({}, 'mod-1', 'mc-preto', 't-p', 2);
    const r = resumoPedido(c, v);
    expect(r.aConfirmar).toBe(true);
    expect(r.lucro).toBeNull();
    expect(r.faltamMinimo).toBe(3);
  });
});

describe('próxima faixa no carrinho', () => {
  it('a barra vai só até a PRÓXIMA faixa; no topo fica cheia', () => {
    expect(progressoFaixa(30, faixas)).toEqual({ alvo: 50, pct: 60 });
    expect(progressoFaixa(120, faixas)).toEqual({ alvo: 500, pct: 24 });
    expect(progressoFaixa(600, faixas)).toEqual({ alvo: 500, pct: 100 });
  });

  it('"adicione 20 peças para seu lucro ser R$ X" — mesma mistura, preço da faixa nova', () => {
    const c = somar({}, 'mod-1', 'mc-preto', 't-p', 30); // 30 peças, Entrada
    // Volume: 89,90 − 40 = 49,90/peça × 50 peças
    expect(lucroNaProximaFaixa(c, vitrine())).toEqual({ faixa: 'volume', faltam: 20, lucro: 2495 });
  });

  it('sem revenda sugerida ou já no topo → sem estimativa', () => {
    const semSug = vitrine([modelo({ linhas: [linha({ precoSugerido: null })] })]);
    expect(lucroNaProximaFaixa(somar({}, 'mod-1', 'mc-preto', 't-p', 30), semSug)).toBeNull();
    expect(lucroNaProximaFaixa(somar({}, 'mod-1', 'mc-preto', 't-p', 600), vitrine())).toBeNull();
    expect(lucroNaProximaFaixa({}, vitrine())).toBeNull();
  });

  it('card mostra só faixa com preço próprio e mínimo configurado', () => {
    expect(precosPorFaixa(linha(), faixas).map((x) => [x.faixa, x.minimo, x.preco])).toEqual([
      ['entrada', 5, 45],
      ['volume', 50, 40],
      ['atacadao', 500, 36],
    ]);
    expect(
      precosPorFaixa(linha({ precoVolume: null }), { ...faixas, minimoAtacadao: null }).map(
        (x) => x.faixa,
      ),
    ).toEqual(['entrada']);
  });
});

describe('fotos por linha (biotipo)', () => {
  const f = (url: string, linhaId: string | null = null) => ({
    url,
    thumbUrl: null,
    largura: 1080,
    altura: 1440,
    linhaId,
  });
  const cor = (
    fotos: ReturnType<typeof f>[],
    amostra: { x: number; y: number } | null = { x: 0.4, y: 0.5 },
  ) => ({
    id: 'mc',
    nome: 'Preto',
    hex: '#111111',
    fotos,
    amostra,
  });

  it('linha com foto própria mostra só as dela', () => {
    const c = cor([f('geral'), f('plus-1', 'plus'), f('plus-2', 'plus'), f('inf', 'infantil')]);
    expect(fotosDaLinha(c, 'plus').map((x) => x.url)).toEqual(['plus-1', 'plus-2']);
  });

  it('linha sem foto própria cai nas gerais (o comportamento de antes)', () => {
    const c = cor([f('geral-1'), f('geral-2'), f('plus-1', 'plus')]);
    expect(fotosDaLinha(c, 'regular').map((x) => x.url)).toEqual(['geral-1', 'geral-2']);
    expect(fotosDaLinha(c, null).map((x) => x.url)).toEqual(['geral-1', 'geral-2']);
  });

  it('sem foto geral nem da linha, mostra o que houver (nunca cor sem foto)', () => {
    const c = cor([f('plus-1', 'plus')]);
    expect(fotosDaLinha(c, 'regular').map((x) => x.url)).toEqual(['plus-1']);
  });

  it('a bolinha sai da capa GERAL; sem geral, usa a 1ª foto e larga o ponto', () => {
    const comGeral = corDaBolinha(cor([f('plus-1', 'plus'), f('geral')]));
    expect(comGeral.fotos.map((x) => x.url)).toEqual(['geral']);
    expect(comGeral.amostra).toEqual({ x: 0.4, y: 0.5 });
    const semGeral = corDaBolinha(cor([f('plus-1', 'plus')]));
    expect(semGeral.fotos[0].url).toBe('plus-1');
    expect(semGeral.amostra).toBeNull();
  });
});

describe('kit pra anunciar', () => {
  it('texto com título, descrição, ficha, tamanhos, medidas e cores', () => {
    const t = textoKit(
      modelo({
        linhas: [
          linha({
            tabelaMedidas: {
              colunas: ['Cintura', 'Comprimento'],
              linhas: [{ tamanho: 'P', valores: ['38', '45'] }],
            },
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
    expect(textoKit(modelo({ tituloMarketplace: null }))).toContain(
      'TÍTULO SUGERIDO\nBermuda Moletom Summer',
    );
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

describe('pedido mínimo da empresa', () => {
  const linha: LinhaPub = {
    id: 'l1',
    linhaId: 'L',
    nome: 'Regular',
    tamanhos: [{ id: 't1', nome: 'P' }],
    precoEntrada: 45,
    precoVolume: null,
    precoAtacadao: null,
    precoSugerido: null,
    tabelaMedidas: null,
  };
  const modelo = { id: 'm1', linhas: [linha], cores: [{ id: 'c1' }] } as unknown as ModeloPub;
  const vit = (pedidoMinimo: VitrinePub['pedidoMinimo'], l = linha): VitrinePub =>
    ({
      empresa: { nome: 'R', logoUrl: null },
      faixas: { minimoEntrada: null, minimoVolume: 50, minimoAtacadao: 500 },
      linhas: [],
      modelos: [{ ...modelo, linhas: [l] }],
      pedidoMinimo,
    }) as VitrinePub;
  const carr = (q: number): Carrinho => ({ m1: { c1: { t1: q } } });

  it('R$ 600: com 10 peças a R$ 45 faltam R$ 150', () => {
    const r = resumoPedido(carr(10), vit({ valorMin: 600, quantidadeMin: null, modo: 'E' }));
    expect(r.faltaValor).toBe(150);
    expect(r.faltamMinimo).toBe(0);
  });
  it('atingiu o valor: nada falta', () => {
    expect(
      resumoPedido(carr(14), vit({ valorMin: 600, quantidadeMin: null, modo: 'E' })).faltaValor,
    ).toBe(0);
  });
  it('sem regra: não trava por valor', () => {
    expect(resumoPedido(carr(1), vit(null)).faltaValor).toBe(0);
  });
  it('item sob consulta: o valor não trava', () => {
    const r = resumoPedido(
      carr(1),
      vit({ valorMin: 600, quantidadeMin: null, modo: 'E' }, { ...linha, precoEntrada: null }),
    );
    expect(r.faltaValor).toBe(0);
  });
  it('"50 peças OU R$ 600": falta os dois e diz que é OU', () => {
    const r = resumoPedido(carr(10), vit({ valorMin: 600, quantidadeMin: 50, modo: 'OU' }));
    expect(r).toMatchObject({ faltamMinimo: 40, faltaValor: 150, minimoOu: true });
  });
  it('"50 peças OU R$ 600": o valor chegou primeiro, libera', () => {
    const r = resumoPedido(carr(14), vit({ valorMin: 600, quantidadeMin: 50, modo: 'OU' }));
    expect(r).toMatchObject({ faltamMinimo: 0, faltaValor: 0 });
  });
  it('"50 peças OU R$ 600" com item sob consulta: as 50 peças continuam valendo', () => {
    const r = resumoPedido(
      carr(20),
      vit({ valorMin: 600, quantidadeMin: 50, modo: 'OU' }, { ...linha, precoEntrada: null }),
    );
    expect(r).toMatchObject({ faltamMinimo: 30, faltaValor: 0 });
  });
  it('regra OU: cumprir as peças basta', () => {
    const r = resumoPedido(carr(20), vit({ valorMin: 6000, quantidadeMin: 20, modo: 'OU' }));
    expect(r.faltaValor).toBe(0);
    expect(r.faltamMinimo).toBe(0);
  });
});

describe('vitrine que respeita estoque', () => {
  const m = {
    id: 'm1',
    estoque: { c1: { p: 3, m: 0 } },
    cores: [{ id: 'c1' }],
    linhas: [{ tamanhos: [{ id: 'p' }, { id: 'm' }, { id: 'g' }] }],
  } as unknown as ModeloPub;

  it('disponível por cor × tamanho; desconhecido = 0; sem controle = null', () => {
    expect(disponivelDe(m, 'c1', 'p')).toBe(3);
    expect(disponivelDe(m, 'c1', 'g')).toBe(0);
    expect(disponivelDe({ ...m, estoque: null }, 'c1', 'p')).toBeNull();
  });
  it('somar não passa do que tem', () => {
    const c = somar({}, 'm1', 'c1', 'p', 6, 3);
    expect(c.m1.c1.p).toBe(3);
    expect(somar({}, 'm1', 'c1', 'm', 6, 0)).toEqual({});
  });
  it('carrinho salvo no celular volta cortado ao que tem agora', () => {
    const v = { modelos: [m] } as unknown as VitrinePub;
    expect(limparCarrinho({ m1: { c1: { p: 10, m: 4 } } }, v)).toEqual({ m1: { c1: { p: 3 } } });
  });
});

describe('1ª opção com estoque e linha sem o modelo (Léo, 07/10)', () => {
  // Preto esgotado nos dois tamanhos; Bege com M.
  const comEstoque = modelo({
    estoque: { 'mc-preto': { 't-p': 0, 't-m': 0 }, 'mc-bege': { 't-p': 0, 't-m': 3 } },
  });

  it('cor esgotada nesta linha nunca é a 1ª: abre na 1ª com estoque', () => {
    expect(corTemEstoque(comEstoque, 'mc-preto', linha())).toBe(false);
    expect(corTemEstoque(comEstoque, 'mc-bege', linha())).toBe(true);
    expect(corInicial(comEstoque, linha()).nome).toBe('Bege');
    expect(coresPorEstoque(comEstoque, linha()).map((c) => c.nome)).toEqual(['Bege', 'Preto']);
  });

  it('sem controle de estoque: a ordem do cadastro, como antes', () => {
    const m = modelo({ estoque: null });
    expect(corInicial(m, linha()).nome).toBe('Preto');
    expect(coresPorEstoque(m, linha())).toBe(m.cores);
  });

  it('tudo esgotado: abre na 1ª do cadastro (não some cor nenhuma)', () => {
    const m = modelo({ estoque: { 'mc-preto': {}, 'mc-bege': {} } });
    expect(corInicial(m, linha()).nome).toBe('Preto');
    expect(coresPorEstoque(m, linha())).toHaveLength(2);
  });

  it('o estoque é DA LINHA: a mesma cor pode ter no Regular e faltar no Plus', () => {
    const plus = linha({
      id: 'ml-plus',
      linhaId: 'lin-plus',
      nome: 'Plus',
      tamanhos: [{ id: 't-g1', nome: 'G1' }],
    });
    const m = modelo({
      linhas: [linha(), plus],
      estoque: { 'mc-preto': { 't-m': 5, 't-g1': 0 }, 'mc-bege': { 't-g1': 2 } },
    });
    expect(corInicial(m, linha()).nome).toBe('Preto');
    expect(corInicial(m, plus).nome).toBe('Bege');
  });

  it('temLinha: só as linhas que o modelo tem', () => {
    expect(temLinha(modelo(), 'lin-reg')).toBe(true);
    expect(temLinha(modelo(), 'lin-plus')).toBe(false);
  });
});
