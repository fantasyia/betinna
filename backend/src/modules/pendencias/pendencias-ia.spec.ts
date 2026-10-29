import { describe, expect, it } from 'vitest';
import {
  ESPERA_PADRAO,
  baseParaConversa,
  cardsDoHistorico,
  clienteFalouPorUltimo,
  clienteTerminou,
  contextoDaPendencia,
  lerDecisao,
  unitarioDoAnuncio,
} from './pendencias-ia';

describe('IA das pendências (fase 2, 25/10)', () => {
  it('lê a decisão; JSON quebrado ou vazio vira humano com a espera (nunca silêncio)', () => {
    expect(
      lerDecisao('{"acao":"responder","resposta":"Nós que agradecemos!","motivo":"agradecimento"}'),
    ).toEqual({
      acao: 'responder',
      resposta: 'Nós que agradecemos!',
      motivo: 'agradecimento',
      cardUnitario: false,
    });
    expect(lerDecisao('{"acao":"responder","resposta":"","motivo":"x"}')).toMatchObject({
      acao: 'humano',
      resposta: ESPERA_PADRAO,
    });
    expect(lerDecisao('{"acao":"humano","resposta":"","motivo":"reembolso"}')).toMatchObject({
      acao: 'humano',
      resposta: ESPERA_PADRAO,
      motivo: 'reembolso',
    });
    expect(lerDecisao('nada a ver')).toMatchObject({ acao: 'humano', resposta: ESPERA_PADRAO });
    expect(lerDecisao('{"acao":"aceitar_devolucao","resposta":"ok"}').acao).toBe('humano');
  });

  it('a IA só entra quando o cliente falou por último', () => {
    expect(
      clienteFalouPorUltimo([
        { daLoja: true, texto: 'oi' },
        { daLoja: false, texto: 'obg' },
      ]),
    ).toBe(true);
    expect(
      clienteFalouPorUltimo([
        { daLoja: false, texto: 'obg' },
        { daLoja: true, texto: 'nós que agradecemos' },
      ]),
    ).toBe(false);
    expect(clienteFalouPorUltimo([])).toBe(false);
  });

  it('contexto leva conhecimento, pedido e a conversa na ordem', () => {
    const c = contextoDaPendencia({
      canal: 'MARKETPLACE_SHOPEE',
      tipo: 'MENSAGEM',
      titulo: 'Mensagem de fulano',
      conhecimento: [{ titulo: 'Trocas', conteudo: '7 dias' }],
      pedido: 'Kit 2 bermudas · enviado',
      historico: [
        { daLoja: false, texto: 'cadê meu pedido?' },
        { daLoja: true, texto: 'já saiu' },
        { daLoja: false, texto: 'obg' },
      ],
    });
    expect(c).toContain('Shopee');
    expect(c).toContain('## Trocas');
    expect(c).toContain('PEDIDO:\nKit 2 bermudas');
    expect(c.indexOf('CLIENTE: cadê')).toBeLessThan(c.indexOf('LOJA: já saiu'));
    expect(c).toContain('CLIENTE: obg');
  });

  it('card de produto/pedido e figurinha viram texto que a IA entende', () => {
    const h = [
      { daLoja: false, texto: '[produto: 555]' },
      { daLoja: false, texto: '[pedido: 261027PA82X36N]' },
      { daLoja: false, texto: '[sticker]' },
    ];
    expect(cardsDoHistorico(h)).toEqual({ itens: ['555'], pedidos: ['261027PA82X36N'] });
    const c = contextoDaPendencia({
      canal: 'MARKETPLACE_SHOPEE',
      tipo: 'MENSAGEM',
      titulo: 'x',
      conhecimento: [],
      anuncios: [{ id: '555', nome: 'Bermuda de Moletom', descricao: 'P 38 · M 40' }],
      historico: h,
    });
    expect(c).toContain('[mandou o card do anúncio "Bermuda de Moletom"]');
    expect(c).toContain('[mandou o card do pedido 261027PA82X36N]');
    expect(c).toContain('[mandou uma figurinha]');
    expect(c).toContain('### Bermuda de Moletom\nP 38 · M 40');
  });

  it('silêncio: só responde depois de 30 s sem o cliente escrever (Léo, 26/10)', () => {
    const agora = new Date('2026-10-26T12:00:00Z');
    expect(clienteTerminou(new Date('2026-10-26T11:59:50Z'), agora)).toBe(false);
    expect(clienteTerminou(new Date('2026-10-26T11:59:25Z'), agora)).toBe(true);
  });

  it('base: com produto vai só a ficha dele (+ pós-venda); sem produto, a base inteira', () => {
    const base = [
      { titulo: 'Produto · Bermuda de Moletom', categoria: 'produtos' },
      { titulo: 'Produto · Calça de Moletom', categoria: 'produtos' },
      { titulo: 'Troca, defeito e devolução', categoria: 'pos_venda' },
    ];
    const anuncio = 'Bermuda de Moletom Com Amarração e Elástico Academia Masculina';
    expect(baseParaConversa(base, [anuncio]).map((c) => c.titulo)).toEqual([
      'Troca, defeito e devolução',
      'Produto · Bermuda de Moletom',
    ]);
    expect(baseParaConversa(base, [])).toHaveLength(3);
    expect(baseParaConversa(base, ['Boné aba reta'])).toHaveLength(3);
  });

  it('acha o anúncio unitário no link da descrição do kit (Léo, 29/10)', () => {
    expect(
      unitarioDoAnuncio({
        id: '10801442351',
        descricao: 'acesse este link https://shopee.com.br/product/327263189/11501442309/',
      }),
    ).toBe('11501442309');
    expect(
      unitarioDoAnuncio({
        id: '8711614693',
        descricao:
          'acesse este link https://shopee.com.br/Shorts-de-Moleton-Plus-Size-i.327263189.12582857765 ok',
      }),
    ).toBe('12582857765');
    // link pro próprio anúncio não é o unitário; sem link, nada
    expect(
      unitarioDoAnuncio({ id: '5', descricao: 'https://shopee.com.br/product/327263189/5/' }),
    ).toBeNull();
    expect(unitarioDoAnuncio({ id: '5', descricao: 'sem link' })).toBeNull();
  });

  it('card_unitario só vale numa resposta; ausente ou "humano" é false', () => {
    expect(
      lerDecisao('{"acao":"responder","resposta":"a","motivo":"b","card_unitario":true}')
        .cardUnitario,
    ).toBe(true);
    expect(lerDecisao('{"acao":"responder","resposta":"a","motivo":"b"}').cardUnitario).toBe(false);
    expect(
      lerDecisao('{"acao":"humano","resposta":"a","motivo":"b","card_unitario":true}').cardUnitario,
    ).toBeUndefined();
  });
});
