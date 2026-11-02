import { describe, expect, it, vi } from 'vitest';
import { SheinAnunciosController } from './shein-anuncios.controller';
import { consultaPermitida, corpoPreco, resultadoPreco, resumoSpu } from './shein-anuncios';

/** Anúncios da Shein (#05, Léo 01/11). */
describe('anúncios da Shein', () => {
  it('preço: promocional SEMPRE explícito (sem ele a Shein zera); null vira 0', () => {
    const c = corpoPreco([
      { skuCode: 'I1', preco: 59.9, precoPromocional: 49.9 },
      { skuCode: 'I2', preco: 59.9, precoPromocional: null },
    ]);
    expect(c.productPriceList).toEqual([
      {
        productCode: 'I1',
        site: 'shein-br',
        currencyCode: 'BRL',
        shopPrice: 59.9,
        specialPrice: 49.9,
        riseReason: null,
      },
      {
        productCode: 'I2',
        site: 'shein-br',
        currencyCode: 'BRL',
        shopPrice: 59.9,
        specialPrice: 0,
        riseReason: null,
      },
    ]);
  });

  it('preço: recusa promocional >= preço e SKU repetido antes de mandar', () => {
    expect(() => corpoPreco([{ skuCode: 'I1', preco: 50, precoPromocional: 50 }])).toThrow(/MENOR/);
    expect(() =>
      corpoPreco([
        { skuCode: 'I1', preco: 50, precoPromocional: null },
        { skuCode: 'I1', preco: 40, precoPromocional: null },
      ]),
    ).toThrow(/repetido/);
  });

  it('resultado: aceito, em revisão e recusado com o motivo', () => {
    expect(
      resultadoPreco([
        { productCode: 'I1', success: true, status: 1 },
        { productCode: 'I2', success: true, status: 2 },
        { productCode: 'I3', success: false, status: 0, message: 'bloqueado por campanha' },
      ]),
    ).toEqual({
      aceitos: ['I1'],
      emRevisao: ['I2'],
      recusados: [{ skuCode: 'I3', motivo: 'bloqueado por campanha' }],
    });
  });

  it('resumo do SPU: cor por SKC, tamanho, SKU do vendedor, preço e no ar', () => {
    const r = resumoSpu({
      spuName: 'M1',
      productMultiNameList: [{ language: 'pt-br', productName: 'Bermuda' }],
      skcInfoList: [
        {
          skcName: 's1',
          attributeValueMultiList: [{ language: 'pt-br', attributeValueName: 'Preto' }],
          shelfStatusInfoList: [{ siteAbbr: 'shein-br', shelfStatus: 1 }],
          skuInfoList: [
            {
              skuCode: 'I1',
              supplierSku: 'BERM-PRT-M',
              mallState: 1,
              saleAttributeList: [
                { attributeValueMultiList: [{ language: 'pt-br', attributeValueName: 'M' }] },
              ],
              priceInfoList: [
                { site: 'shein-br', basePrice: 59.9, specialPrice: 0, currency: 'BRL' },
              ],
            },
          ],
        },
      ],
    });
    expect(r.nome).toBe('Bermuda');
    expect(r.cores[0]).toMatchObject({ cor: 'Preto', noAr: { 'shein-br': true } });
    expect(r.cores[0].variacoes[0]).toEqual({
      skuCode: 'I1',
      skuVendedor: 'BERM-PRT-M',
      tamanho: 'M',
      aVenda: true,
      precos: [{ site: 'shein-br', moeda: 'BRL', preco: 59.9, precoPromocional: null }],
    });
  });

  it('consulta genérica só nos caminhos de leitura', () => {
    expect(consultaPermitida('/open-api/goods/query-attribute-template')).toBe(true);
    expect(consultaPermitida('/open-api/goods/product/partialEdit')).toBe(false);
    expect(consultaPermitida('/open-api/openapi-business-backend/product/price/save')).toBe(false);
  });
});

describe('listar anúncios: todas as páginas (02/11, #02)', () => {
  it('pagina até a página incompleta e devolve o total de cores e anúncios', async () => {
    const pagina = (n: number, tam: number, spu: string) =>
      Array.from({ length: tam }, (_, i) => ({ spuName: `${spu}${i % 2}`, skcName: `p${n}-${i}` }));
    const post = vi
      .fn()
      .mockResolvedValueOnce({ data: pagina(1, 50, 'a') })
      .mockResolvedValueOnce({ data: pagina(2, 7, 'b') });
    const ctrl = new SheinAnunciosController({ post } as never);
    const r = (await ctrl.listar({ empresaIdAtiva: 'emp1' } as never, {
      pagina: 1,
      porPagina: 50,
      todas: '1',
    })) as { totalCores: number; totalAnuncios: number };
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][2]).toMatchObject({ pageNum: 2, pageSize: 50 });
    expect(r).toMatchObject({ totalCores: 57, totalAnuncios: 4 });
  });
});

describe('campanhas e preço sugerido (02/11, #02)', () => {
  it('leituras de campanha/preço sugerido liberadas no consultar; escrita só no escrever', async () => {
    const { consultaPermitida, escritaPermitida } = await import('./shein-anuncios');
    expect(consultaPermitida('/open-api/campaigns/campaign-list')).toBe(true);
    expect(consultaPermitida('/open-api/goods-recommend-retail-price/search')).toBe(true);
    expect(consultaPermitida('/open-api/campaigns/register-campaign')).toBe(false);
    expect(escritaPermitida('/open-api/campaigns/register-campaign')).toBe(true);
    expect(escritaPermitida('/open-api/goods-recommend-retail-price/batch-save')).toBe(true);
    expect(escritaPermitida('/open-api/goods/product/partialEdit')).toBe(false);
  });

  it('escrever recusa caminho fora da lista sem chamar a Shein', async () => {
    const post = vi.fn();
    const ctrl = new SheinAnunciosController({ post } as never);
    expect(() =>
      ctrl.escrever({ empresaIdAtiva: 'e1' } as never, {
        caminho: '/open-api/order/order-list',
        corpo: {},
      }),
    ).toThrow(/não liberado/);
    expect(post).not.toHaveBeenCalled();
  });
});
