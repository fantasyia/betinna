import { describe, expect, it } from 'vitest';
import {
  conversaShein,
  horaPequim,
  incidenteShein,
  statusConversaPosVenda,
  statusPosVenda,
  tipoPosVenda,
} from './shein-pos-venda';

/** Pós-venda da Shein → incidente (Léo, 01/11). */
const caso = {
  aftersalesOrderNo: 'AC260908501761',
  orderNo: 'GSO1YR404CV',
  aftersalesOrderSubStatus: 15,
  aftersalesResolutionPlan: 1,
  refundRatio: 50,
  requestTime: '2026-09-01 09:41:51',
  etaTime: '2026-09-05 10:00:00',
  uploadExpressEtaTime: '2026-09-03 12:00:00',
  applyInfo: { buyerRemark: 'veio pequeno' },
  goodsList: [
    {
      skuSn: 'BERM-PRT-M',
      goodsAttributes: [{ attrValueNames: 'Preto-M', language: 'PT' }],
      aftersalesReasonList: [{ reason: 'Too small', language: 'EN' }],
    },
  ],
  costSummary: { totalGoodsSettlePrice: 59.9 },
};

describe('pós-venda da Shein', () => {
  it('o que espera a loja vira AGUARDANDO_VENDEDOR; o resto, situação certa', () => {
    expect(statusPosVenda(1)).toBe('AGUARDANDO_VENDEDOR');
    expect(statusPosVenda(15)).toBe('AGUARDANDO_VENDEDOR');
    expect(statusPosVenda(14)).toBe('AGUARDANDO_VENDEDOR');
    expect(statusPosVenda(4)).toBe('AGUARDANDO_COMPRADOR');
    expect(statusPosVenda(10)).toBe('EM_MEDIACAO');
    expect(statusPosVenda(9)).toBe('RESOLVIDO');
    expect(statusPosVenda(13)).toBe('CANCELADO');
  });

  it('status desconhecido ESTOURA — nunca vira situação plausível', () => {
    expect(() => statusPosVenda(99)).toThrow(/desconhecido/);
  });

  it('tipo: disputa, reembolso/troca = reclamação, o resto devolução', () => {
    expect(tipoPosVenda(10, 1)).toBe('DISPUTA');
    expect(tipoPosVenda(1, 2)).toBe('RECLAMACAO');
    expect(tipoPosVenda(1, 4)).toBe('RECLAMACAO');
    expect(tipoPosVenda(1, 1)).toBe('DEVOLUCAO');
    expect(tipoPosVenda(1, null)).toBe('DEVOLUCAO');
  });

  it('hora da Shein é UTC+8', () => {
    expect(horaPequim('2026-09-01 09:41:51')?.toISOString()).toBe('2026-09-01T01:41:51.000Z');
    expect(horaPequim(null)).toBeNull();
  });

  it('monta o incidente: prazo da etiqueta, valor, reembolso proporcional, motivo e resumo', () => {
    const i = incidenteShein(caso);
    expect(i).toMatchObject({
      externalId: 'AC260908501761',
      tipo: 'DEVOLUCAO',
      status: 'AGUARDANDO_VENDEDOR',
      pedidoExternoId: 'GSO1YR404CV',
      valor: 59.9,
      valorReembolso: 29.95,
      motivo: 'Too small — veio pequeno',
      motivoCodigo: '15',
    });
    expect(i.prazoResposta?.toISOString()).toBe('2026-09-03T04:00:00.000Z');
    expect(i.resumo).toContain('loja precisa subir a etiqueta');
    expect(i.resumo).toContain('BERM-PRT-M Preto-M');
  });

  it('status da conversa: só o que espera a loja fica PENDENTE', () => {
    expect(statusConversaPosVenda('AGUARDANDO_VENDEDOR')).toBe('PENDENTE');
    expect(statusConversaPosVenda('ABERTO')).toBe('PENDENTE');
    expect(statusConversaPosVenda('AGUARDANDO_COMPRADOR')).toBe('ABERTA');
    expect(statusConversaPosVenda('EM_MEDIACAO')).toBe('ABERTA');
    expect(statusConversaPosVenda('RESOLVIDO')).toBe('RESOLVIDA');
    expect(statusConversaPosVenda('CANCELADO')).toBe('RESOLVIDA');
  });

  it('conversa do Inbox: chave pelo nº do caso, resumo legível e categoria', () => {
    const c = conversaShein(caso);
    expect(c.peerId).toBe('posvenda:AC260908501761');
    expect(c.peerNome).toBe('Pós-venda Shein #AC260908501761');
    expect(c.categoria).toBe('DEVOLUCAO');
    expect(c.statusConversa).toBe('PENDENTE');
    expect(c.conteudo).toContain('Pedido: GSO1YR404CV');
    expect(c.conteudo).toContain('Tipo: devolução e reembolso');
    expect(c.conteudo).toContain('Situação: loja precisa subir a etiqueta');
    expect(c.conteudo).toContain('Motivo: Too small — veio pequeno');
    expect(c.conteudo).toContain('Peças: BERM-PRT-M Preto-M');
    expect(c.conteudo).toContain('Valor: R$ 59,90 · reembolso R$ 29,95');
    // 03/09 12:00 em UTC+8 = 03/09 01:00 em Brasília
    expect(c.conteudo).toContain('Prazo: 03/09/2026');
    expect(c.externalId).toMatch(/^posvenda:AC260908501761:[0-9a-f]{12}$/);
  });

  it('mesmo estado = mesmo externalId; situação nova = mensagem nova na mesma conversa', () => {
    const a = conversaShein(caso);
    expect(conversaShein({ ...caso }).externalId).toBe(a.externalId);
    const b = conversaShein({ ...caso, aftersalesOrderSubStatus: 11 });
    expect(b.externalId).not.toBe(a.externalId);
    expect(b.peerId).toBe(a.peerId);
    expect(b.statusConversa).toBe('RESOLVIDA');
  });

  it('disputa vira categoria DISPUTA; sem valor não inventa linha de valor', () => {
    const c = conversaShein({
      aftersalesOrderNo: 'AC1',
      aftersalesOrderSubStatus: 10,
      aftersalesResolutionPlan: 2,
    });
    expect(c.categoria).toBe('DISPUTA');
    expect(c.statusConversa).toBe('ABERTA');
    expect(c.conteudo).not.toContain('Valor:');
    expect(c.conteudo).toContain('Tipo: só reembolso');
  });
});
