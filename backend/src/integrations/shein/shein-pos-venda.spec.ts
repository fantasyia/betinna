import { describe, expect, it } from 'vitest';
import { horaPequim, incidenteShein, statusPosVenda, tipoPosVenda } from './shein-pos-venda';

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
});
