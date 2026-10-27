import { describe, expect, it } from 'vitest';
import {
  ESPERA_PADRAO,
  cardsDoHistorico,
  clienteFalouPorUltimo,
  clienteTerminou,
  contextoDaPendencia,
  lerDecisao,
} from './pendencias-ia';

describe('IA das pendências (fase 2, 25/10)', () => {
  it('lê a decisão; JSON quebrado ou vazio vira humano com a espera (nunca silêncio)', () => {
    expect(
      lerDecisao('{"acao":"responder","resposta":"Nós que agradecemos!","motivo":"agradecimento"}'),
    ).toEqual({
      acao: 'responder',
      resposta: 'Nós que agradecemos!',
      motivo: 'agradecimento',
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

  it('silêncio: só responde depois de alguns minutos sem o cliente escrever', () => {
    const agora = new Date('2026-10-26T12:00:00Z');
    expect(clienteTerminou(new Date('2026-10-26T11:59:00Z'), agora)).toBe(false);
    expect(clienteTerminou(new Date('2026-10-26T11:50:00Z'), agora)).toBe(true);
  });
});
