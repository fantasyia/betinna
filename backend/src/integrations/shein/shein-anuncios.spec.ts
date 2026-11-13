import { describe, expect, it, vi } from 'vitest';
import { SheinAnunciosController } from './shein-anuncios.controller';
import {
  consultaPermitida,
  corpoPreco,
  corpoPublicacao,
  escritaPermitida,
  resultadoPreco,
  resultadoPublicacao,
  resumoSpu,
} from './shein-anuncios';

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
    const postRastreado = vi.fn();
    const ctrl = new SheinAnunciosController({ postRastreado } as never);
    await expect(
      ctrl.escrever({ empresaIdAtiva: 'e1' } as never, {
        caminho: '/open-api/order/order-list',
        corpo: {},
      }),
    ).rejects.toThrow(/não liberado/);
    expect(postRastreado).not.toHaveBeenCalled();
  });

  it('escrever devolve a resposta da Shein com o rastreio junto', async () => {
    const postRastreado = vi.fn().mockResolvedValue({
      info: { failedList: [{ skc: 's1', code: '3011' }] },
      rastreio: { traceId: 't-123' },
    });
    const ctrl = new SheinAnunciosController({ postRastreado } as never);
    const r = await ctrl.escrever({ empresaIdAtiva: 'e1' } as never, {
      caminho: '/open-api/campaigns/register-campaign',
      corpo: { activityId: '1' },
    });
    expect(postRastreado).toHaveBeenCalledWith('e1', '/open-api/campaigns/register-campaign', {
      activityId: '1',
    });
    expect(r).toEqual({
      failedList: [{ skc: 's1', code: '3011' }],
      rastreio: { traceId: 't-123' },
    });
  });

  it('rastreioShein: campos extras do envelope e cabeçalhos de id, sem code/msg/info', async () => {
    const { rastreioShein } = await import('./shein.client');
    const h = new Headers({ 'x-request-id': 'r1', traceparent: 'tp', 'content-type': 'x' });
    expect(
      rastreioShein({ code: '0', msg: 'ok', info: {}, traceId: 't1', bbl: { a: 1 } }, h),
    ).toEqual({
      traceId: 't1',
      bbl: '{"a":1}',
      'header:x-request-id': 'r1',
      'header:traceparent': 'tp',
    });
  });
});

describe('preço Shein BR (02/11): só o preço de venda', () => {
  it('sem precoPromocional vai specialPrice 0 (um preço só)', () => {
    expect(corpoPreco([{ skuCode: 'I1', preco: 39.99 }]).productPriceList[0]).toMatchObject({
      shopPrice: 39.99,
      specialPrice: 0,
    });
  });
});

describe('edição de anúncio Shein (07/11)', () => {
  const spu = (titulo: string, extra: object = {}) => ({
    spuName: 'm1',
    productMultiNameList: [{ language: 'pt-br', productName: titulo }],
    productAttributeInfoList: [
      { attributeId: 27, attributeValueId: 100 },
      { attributeId: 87, attributeValueId: 19 },
      { attributeId: 62, attributeValueId: 212, attributeValue: 50 },
      { attributeId: 62, attributeValueId: 526, attributeValue: 50 },
      { attributeId: 109, attributeValueId: 107 },
    ],
    skcInfoList: [
      {
        skcName: 's1',
        attributeId: 27,
        skuInfoList: [{ saleAttributeList: [{ attributeId: 87 }] }],
        skcImageInfoList: [],
      },
    ],
    ...extra,
  });
  const livre = { data: [{ version: 'V0', skcList: [{ documentState: 2 }] }] };
  /** A edição lê a revisão antes: `livre` entra na ordem em que ela é chamada. */
  const montar = (respostas: unknown[]) => {
    const post = vi.fn();
    for (const r of respostas) post.mockResolvedValueOnce(r);
    return { post, ctrl: new SheinAnunciosController({ post } as never) };
  };
  const user = { empresaIdAtiva: 'e1' } as never;

  it('atributos de venda (cor e tamanho) não entram na lista do produto', async () => {
    const { atributosProduto } = await import('./shein-anuncios');
    expect(atributosProduto(spu('x') as never)).toEqual([
      { attribute_id: 62, attribute_value_id: 212, attribute_extra_value: '50' },
      { attribute_id: 62, attribute_value_id: 526, attribute_extra_value: '50' },
      { attribute_id: 109, attribute_value_id: 107 },
    ]);
  });

  it('título manda só o nome e confere pela releitura', async () => {
    const { post, ctrl } = montar([
      livre,
      spu('velho'),
      { success: true, version: 'V1' },
      spu('novo'),
    ]);
    const r = await ctrl.titulo(user, 'm1', { titulo: 'novo' });
    expect(post.mock.calls[2][1]).toBe('/open-api/goods/product/partialEdit');
    expect(post.mock.calls[2][2]).toEqual({
      spu_name: 'm1',
      multi_language_name_list: [{ language: 'pt-br', name: 'novo' }],
    });
    expect(r).toMatchObject({ antes: 'velho', depois: 'novo', conferido: true, versao: 'V1' });
  });

  it('pré-validação da Shein volta como bloqueio, não como enviado', async () => {
    const { ctrl } = montar([
      livre,
      spu('velho'),
      { success: false, pre_valid_result: [{ form_name: 'Título', messages: ['curto'] }] },
      spu('velho'),
    ]);
    const r = await ctrl.titulo(user, 'm1', { titulo: 'novo' });
    expect(r).toMatchObject({ enviado: false, bloqueios: ['Título: curto'], conferido: false });
  });

  it('trocar atributo leva a lista inteira, sem os de venda e sem os valores antigos dele', async () => {
    const { post, ctrl } = montar([spu('x'), livre, spu('x'), { success: true }, spu('x')]);
    await ctrl.atributos(user, 'm1', {
      trocar: [{ attribute_id: 62, attribute_value_id: 212, attribute_extra_value: '100' }],
      remover: [109],
    });
    expect(post.mock.calls[3][2]).toEqual({
      spu_name: 'm1',
      product_attribute_list: [
        { attribute_id: 62, attribute_value_id: 212, attribute_extra_value: '100' },
      ],
    });
  });

  it('remover atributo que não está no anúncio nem chega na Shein', async () => {
    const { post, ctrl } = montar([spu('x')]);
    await expect(ctrl.atributos(user, 'm1', { trocar: [], remover: [999] })).rejects.toThrow(
      /fora do anúncio/,
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('tabela com campo de estoque ou preço é recusada antes de ler', async () => {
    const { post, ctrl } = montar([]);
    await expect(
      ctrl.tabela(user, 'm1', { tabela: [{ attribute_id: 1, stock: 5 }] }),
    ).rejects.toThrow(/estoque nem preço/);
    expect(post).not.toHaveBeenCalled();
  });

  it('foto de fora é convertida antes; foto da Shein vai direto', async () => {
    const { post, ctrl } = montar([
      { transformed: 'https://img.ltwebstatic.com/a.jpg' },
      livre,
      spu('x'),
      { success: true },
      spu('x'),
    ]);
    await ctrl.fotos(user, 'm1', {
      cor: 's1',
      imagens: [
        { url: 'https://cdn.ribelt.com.br/a.jpg', tipo: 1, ordem: 1 },
        { url: 'https://img.ltwebstatic.com/b.jpg', tipo: 2, ordem: 2 },
      ],
    });
    expect(post.mock.calls[0]).toEqual([
      'e1',
      '/open-api/goods/transform-pic',
      { image_type: 1, original_url: 'https://cdn.ribelt.com.br/a.jpg' },
    ]);
    expect(post.mock.calls[3][2]).toEqual({
      spu_name: 'm1',
      skc_list: [
        {
          skc_name: 's1',
          image_info: {
            image_info_list: [
              { image_url: 'https://img.ltwebstatic.com/a.jpg', image_type: 1, image_sort: 1 },
              { image_url: 'https://img.ltwebstatic.com/b.jpg', image_type: 2, image_sort: 2 },
            ],
          },
        },
      ],
    });
  });

  it('foto que a Shein não converte para tudo, sem editar', async () => {
    const { post, ctrl } = montar([{ transformed: '', failure_reason: 'download' }]);
    await expect(
      ctrl.fotos(user, 'm1', {
        imagens: [{ url: 'https://cdn.ribelt.com.br/a.jpg', tipo: 1, ordem: 1 }],
      }),
    ).rejects.toThrow(/download/);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('Shein: plano numa edição só e revisão em andamento (08/11)', () => {
  const spu = (titulo: string) => ({
    spuName: 'm1',
    productMultiNameList: [{ language: 'pt-br', productName: titulo }],
    productMultiDescList: [{ language: 'pt-br', productDesc: 'desc' }],
    productAttributeInfoList: [{ attributeId: 109, attributeValueId: 107 }],
    dimensionAttributeInfoList: [{ x: 1 }],
    skcInfoList: [],
  });
  const user = { empresaIdAtiva: 'e1' } as never;
  const livre = { data: [{ version: 'V0', skcList: [{ documentState: 2 }] }] };

  it('manda título, descrição, atributos e tabela num partialEdit só', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(spu('velho'))
      .mockResolvedValueOnce(livre)
      .mockResolvedValueOnce(spu('velho'))
      .mockResolvedValueOnce({ success: true, version: 'V9' })
      .mockResolvedValueOnce(spu('novo'));
    const ctrl = new SheinAnunciosController({ post } as never);
    const r = await ctrl.plano(user, 'm1', {
      titulo: 'novo',
      descricao: 'd2',
      atributos: { trocar: [{ attribute_id: 109, attribute_value_id: 200 }], remover: [] },
      tabela: [{ attribute_id: 1, attribute_extra_value: '50' }],
    });
    const edicoes = post.mock.calls.filter((c) => c[1] === '/open-api/goods/product/partialEdit');
    expect(edicoes).toHaveLength(1);
    expect(edicoes[0][2]).toEqual({
      spu_name: 'm1',
      multi_language_name_list: [{ language: 'pt-br', name: 'novo' }],
      multi_language_desc_list: [{ language: 'pt-br', name: 'd2' }],
      product_attribute_list: [{ attribute_id: 109, attribute_value_id: 200 }],
      size_attribute_list: [{ attribute_id: 1, attribute_extra_value: '50' }],
    });
    expect(r).toMatchObject({ enviado: true, versao: 'V9' });
  });

  it('SPU em revisão: recusa com o motivo e nem tenta editar', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ version: 'V7', skcList: [{ documentState: 1 }] }] });
    const ctrl = new SheinAnunciosController({ post } as never);
    await expect(ctrl.titulo(user, 'm1', { titulo: 'novo' })).rejects.toThrow(/em revisão.*V7/);
    expect(post.mock.calls.some((c) => c[1] === '/open-api/goods/product/partialEdit')).toBe(false);
  });
});

describe('Shein: vídeo do anúncio (07/11)', () => {
  const user = { empresaIdAtiva: 'e1' } as never;
  const livre = { data: [{ version: 'V0', skcList: [{ documentState: 2 }] }] };
  const URL_SHEIN = 'https://svideo.ltwebstatic.com/spmp/2026/11/07/x.mp4';

  it('converter: manda o link e devolve a tarefa', async () => {
    const post = vi.fn().mockResolvedValue({ task_id: 'abc123', transformed_url: null });
    const ctrl = new SheinAnunciosController({ post } as never);
    const r = await ctrl.videoConverter(user, { url: 'https://x.com/v.mp4' });
    expect(post).toHaveBeenCalledWith('e1', '/open-api/goods/product/create-video-transform-task', {
      video_url: 'https://x.com/v.mp4',
    });
    expect(r).toEqual({ tarefa: 'abc123', url: null });
  });

  it('tarefa: 1 = pronto com a url; 2 = falhou com motivo; status novo estoura', async () => {
    const montar = (data: unknown) =>
      new SheinAnunciosController({ post: vi.fn().mockResolvedValue({ data }) } as never);
    expect(
      await montar([{ task_status: 1, transformed_url: URL_SHEIN }]).videoTarefa(user, 'abc123'),
    ).toMatchObject({ situacao: 'pronto', url: URL_SHEIN });
    expect(
      await montar([{ task_status: 2, fail_reason: { msg: 'grande' } }]).videoTarefa(
        user,
        'abc123',
      ),
    ).toMatchObject({ situacao: 'falhou', motivo: '{"msg":"grande"}' });
    await expect(montar([{ task_status: 9 }]).videoTarefa(user, 'abc123')).rejects.toThrow(
      /desconhecida/,
    );
  });

  it('gravar: recusa link que não foi convertido pela Shein', () => {
    const post = vi.fn();
    const ctrl = new SheinAnunciosController({ post } as never);
    expect(() =>
      ctrl.video(user, 'm1', { url: 'https://x.com/v.mp4', sites: ['shein-br'] }),
    ).toThrow(/convertida/);
    expect(post).not.toHaveBeenCalled();
  });

  it('gravar: partialEdit com product_video_list e confere pela releitura', async () => {
    const spu = (extra: object) => ({ spuName: 'm1', skcInfoList: [], ...extra });
    const post = vi
      .fn()
      .mockResolvedValueOnce(livre)
      .mockResolvedValueOnce(spu({}))
      .mockResolvedValueOnce({ success: true, version: 'V2' })
      .mockResolvedValueOnce(spu({ videoList: [{ url: URL_SHEIN }] }));
    const ctrl = new SheinAnunciosController({ post } as never);
    const r = await ctrl.video(user, 'm1', { url: URL_SHEIN, sites: ['shein-br'] });
    const edicao = post.mock.calls.find((c) => c[1] === '/open-api/goods/product/partialEdit');
    expect(edicao?.[2]).toEqual({
      spu_name: 'm1',
      product_video_list: [{ sites: ['shein-br'], video_url: URL_SHEIN }],
    });
    expect(r).toMatchObject({ antes: false, depois: true, conferido: true });
  });

  describe('publicar SPU novo (13/11)', () => {
    const corpo = {
      category_id: 1,
      site_list: [{ main_site: 'shein', sub_site_list: ['shein-br'] }],
      skc_list: [
        {
          sale_attribute: { attribute_id: 27 },
          sku_list: [
            { supplier_sku: 'A-P', mall_state: 1, stock_info_list: [{ inventory_num: 30 }] },
            { supplier_sku: 'A-M' },
          ],
        },
      ],
    };

    it('força fora de venda e estoque 0 em todo SKU', () => {
      const { corpo: c, ajustes } = corpoPublicacao(corpo);
      const skus = (c.skc_list as Array<{ sku_list: unknown[] }>)[0].sku_list;
      expect(skus).toEqual([
        { supplier_sku: 'A-P', mall_state: 2, stock_info_list: [{ inventory_num: 0 }] },
        { supplier_sku: 'A-M', mall_state: 2, stock_info_list: [{ inventory_num: 0 }] },
      ]);
      expect(ajustes).toEqual(['mall_state = 2 (fora de venda)', 'estoque zerado (vem do Magis5)']);
    });

    it('com spu_name, skc_name ou sku_code é edição: recusa', () => {
      expect(() => corpoPublicacao({ ...corpo, spu_name: 'X' })).toThrow(/edição/);
      expect(() => corpoPublicacao({ skc_list: [{ skc_name: 's', sku_list: [{}] }] })).toThrow(
        /edição/,
      );
      expect(() => corpoPublicacao({ skc_list: [{ sku_list: [{ sku_code: 'I1' }] }] })).toThrow(
        /edição/,
      );
    });

    it('rota: manda o corpo já travado, devolve o criado e o rastreio', async () => {
      const postRastreado = vi.fn().mockResolvedValue({
        info: {
          success: true,
          spu_name: 'MM1',
          version: 'SPMP1',
          skc_list: [{ skc_name: 's1', sku_list: [{ sku_code: 'I1', supplier_sku: 'A-P' }] }],
        },
        rastreio: { traceId: 't-1' },
      });
      const ctrl = new SheinAnunciosController({ postRastreado } as never);
      const r = await ctrl.publicar({ empresaIdAtiva: 'e1' } as never, corpo as never);
      const enviado = postRastreado.mock.calls[0][2] as {
        skc_list: Array<{ sku_list: Array<{ mall_state: number }> }>;
      };
      expect(postRastreado.mock.calls[0][1]).toBe('/open-api/goods/product/publishOrEdit');
      expect(enviado.skc_list[0].sku_list.every((k) => k.mall_state === 2)).toBe(true);
      expect(r).toMatchObject({
        criado: true,
        spu_name: 'MM1',
        versao: 'SPMP1',
        skcs: [{ skc_name: 's1', skus: [{ sku_code: 'I1', supplier_sku: 'A-P' }] }],
        rastreio: { traceId: 't-1' },
      });
    });

    it('rota: corpo de edição não chega na Shein', async () => {
      const postRastreado = vi.fn();
      const ctrl = new SheinAnunciosController({ postRastreado } as never);
      await expect(
        ctrl.publicar({ empresaIdAtiva: 'e1' } as never, { ...corpo, spu_name: 'X' } as never),
      ).rejects.toThrow(/edição/);
      expect(postRastreado).not.toHaveBeenCalled();
    });

    it('barrado pela Shein: devolve o pre_valid_result', () => {
      const r = resultadoPublicacao({
        success: false,
        pre_valid_result: [{ form: 'f', messages: ['falta foto'], module: 'm' }],
      });
      expect(r).toMatchObject({ criado: false, spu_name: null });
      expect(r.pre_valid_result).toEqual([{ form: 'f', messages: ['falta foto'], module: 'm' }]);
    });

    it('revoke-product liberado pra desfazer o teste', () => {
      expect(escritaPermitida('/open-api/goods/revoke-product')).toBe(true);
    });
  });
});
