import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyMapeamentoService } from './tiny-mapeamento.service';

/**
 * "Produto não mapeado pelo integrador".
 *
 * O envio de produtos do ERP não é aviso, é PERGUNTA: "este produto meu, como
 * a sua loja chama?". Enquanto a resposta era só `{ ok: true }`, o ERP marcava
 * o envio como não mapeado — e sem mapeamento o produto não entra na lista do
 * canal, que é exatamente onde a cotação de frete procura o item. O sintoma
 * aparecia lá na ponta, como `Item 'MB-01' não encontrado` no /cotar.
 */
function build(produtos: Array<{ codigoErp: string; sku: string }> = []) {
  const prisma = {
    produto: { findMany: vi.fn().mockResolvedValue(produtos) },
    empresa: {
      findMany: vi.fn().mockResolvedValue([{ id: 'emp-1', cnpj: '12.345.678/0001-90' }]),
    },
    integracaoConexao: { findMany: vi.fn().mockResolvedValue([{ empresaId: 'emp-1' }]) },
  };
  return { svc: new TinyMapeamentoService(prisma as never), prisma };
}

const envio = (dados: unknown, cnpj = '12345678000190') => JSON.stringify({ cnpj, dados });

describe('mapeamento de produto pro ERP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve o id da Olist e o SKU do NOSSO catálogo', async () => {
    const { svc } = build([{ codigoErp: '335240597', sku: 'MB-01' }]);

    const r = await svc.responder(envio({ id: 335240597, descricao: 'Master Block MB-01' }));

    expect(r).toEqual({
      mapeamentos: [{ mapeamento: { idMapeamento: 335240597, skuMapeamento: 'MB-01' } }],
    });
  });

  it('casa pelo codigoErp, não pelo sku que veio no envio', async () => {
    // O código da loja pode divergir do código do ERP. Quem manda é o nosso
    // catálogo — é o SKU que o site envia na cotação e no pedido.
    const { svc } = build([{ codigoErp: '999', sku: 'MB-07' }]);

    const r = await svc.responder(envio({ id: 999, sku: 'OUTRO-CODIGO' }));

    expect(r.mapeamentos[0].mapeamento.skuMapeamento).toBe('MB-07');
  });

  it('sem o produto no catálogo, usa o sku que o ERP mandou (os dois lados usam MB-01)', async () => {
    const { svc } = build([]);

    const r = await svc.responder(envio({ id: 335240597, sku: 'MB-01' }));

    expect(r.mapeamentos[0].mapeamento.skuMapeamento).toBe('MB-01');
  });

  it('produto que não dá pra mapear volta com ERRO explicado, não sumido', async () => {
    // O painel do ERP mostra esta mensagem pra quem clicou em "enviar".
    // Omitir o item faria o envio parecer bem-sucedido.
    const { svc } = build([]);

    const r = await svc.responder(envio({ id: 42, descricao: 'Produto Fantasma' }));

    expect(r.mapeamentos[0].mapeamento).toMatchObject({ idMapeamento: 42 });
    expect(r.mapeamentos[0].mapeamento.error).toContain('Produto Fantasma');
    expect(r.mapeamentos[0].mapeamento.skuMapeamento).toBeUndefined();
  });

  it('envio com VÁRIOS produtos devolve um mapeamento por produto', async () => {
    const { svc } = build([
      { codigoErp: '1', sku: 'MB-01' },
      { codigoErp: '2', sku: 'MB-02' },
    ]);

    const r = await svc.responder(envio([{ id: 1 }, { id: 2 }]));

    expect(r.mapeamentos.map((m) => m.mapeamento.skuMapeamento)).toEqual(['MB-01', 'MB-02']);
  });

  it('variações entram como itens próprios (o ERP mapeia cada uma)', async () => {
    const { svc } = build([
      { codigoErp: '10', sku: 'MB-10' },
      { codigoErp: '11', sku: 'MB-10-V1' },
    ]);

    const r = await svc.responder(envio({ id: 10, variacoes: [{ id: 11 }] }));

    expect(r.mapeamentos).toHaveLength(2);
    expect(r.mapeamentos[1].mapeamento.skuMapeamento).toBe('MB-10-V1');
  });

  it('produto sem id não vira mapeamento torto', async () => {
    const { svc } = build([]);

    const r = await svc.responder(envio({ descricao: 'sem id' }));

    expect(r.mapeamentos[0].mapeamento.error).toContain('sem id');
  });

  it('corpo ilegível não estoura — devolve lista vazia', async () => {
    const { svc } = build([]);

    expect(await svc.responder('não é json')).toEqual({ mapeamentos: [] });
  });

  it('envio sem dados devolve lista vazia', async () => {
    const { svc } = build([]);

    expect(await svc.responder(JSON.stringify({ cnpj: '123' }))).toEqual({ mapeamentos: [] });
  });

  it('CNPJ de outra empresa NÃO devolve o SKU do nosso catálogo', async () => {
    // Multi-tenant: responder o mapeamento de outro tenant seria vazar catálogo
    // e, pior, amarrar o produto de um cliente na loja de outro.
    const { svc, prisma } = build([{ codigoErp: '335240597', sku: 'MB-01' }]);

    const r = await svc.responder(envio({ id: 335240597 }, '99999999000199'));

    expect(prisma.produto.findMany).not.toHaveBeenCalled();
    expect(r.mapeamentos[0].mapeamento.error).toBeTruthy();
  });
});
