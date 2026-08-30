import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyMapeamentoService } from './tiny-mapeamento.service';

/**
 * "Produto não mapeado pelo integrador".
 *
 * O envio de produtos do ERP não é aviso, é PERGUNTA: "este produto meu, como
 * a sua loja chama?". Sem a resposta certa, o produto não entra na lista do
 * canal — e o sintoma aparece duas pontas depois, como `Item 'MB-01' não
 * encontrado` na cotação de frete.
 *
 * O contrato veio dos arquivos de exemplo da própria Olist
 * (`webhook-produto.json` / `webhook-produto-retorno.json`), e três detalhes
 * dele não estão no texto da página — cada um destes testes existe porque a
 * primeira versão errou justamente ali:
 *
 *  1. a resposta é um ARRAY PURO;
 *  2. `idMapeamento` NÃO é o id do produto — vem separado no envio;
 *  3. o produto está na RAIZ do corpo, não dentro de `dados`.
 *
 * O ponto 2 é o mais traiçoeiro: devolver o id do produto é aceito com 200 e
 * ignorado em silêncio. O painel só repete "não mapeado".
 */
function build(produtos: Array<{ codigoErp: string; sku: string }> = [], conexoes = 1) {
  const prisma = {
    produto: { findMany: vi.fn().mockResolvedValue(produtos) },
    integracaoConexao: {
      findMany: vi
        .fn()
        .mockResolvedValue(Array.from({ length: conexoes }, () => ({ empresaId: 'emp-1' }))),
    },
  };
  return { svc: new TinyMapeamentoService(prisma as never), prisma };
}

/** Como o ERP manda de verdade: produto na raiz, id e idMapeamento separados. */
const envio = (p: Record<string, unknown>) => JSON.stringify(p);

describe('mapeamento de produto pro ERP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('responde um ARRAY PURO — objeto com chave é aceito com 200 e ignorado', async () => {
    const { svc } = build([{ codigoErp: '441393295', sku: 'MB-01' }]);

    const r = await svc.responder(
      envio({ id: '441393295', idMapeamento: '1304432', codigo: 'MB-01' }),
    );

    expect(Array.isArray(r)).toBe(true);
    expect(r).toEqual([{ idMapeamento: '1304432', skuMapeamento: 'MB-01' }]);
  });

  it('devolve o idMapeamento do ENVIO, não o id do produto', async () => {
    // Os dois vêm lado a lado no payload. Devolver o id do produto passa
    // batido: 200, e o painel segue dizendo "não mapeado".
    const { svc } = build([{ codigoErp: '441393295', sku: 'MB-01' }]);

    const r = await svc.responder(
      envio({ id: '441393295', idMapeamento: '1304432', codigo: 'MB-01' }),
    );

    expect(r[0].idMapeamento).toBe('1304432');
    expect(r[0].idMapeamento).not.toBe('441393295');
  });

  it('lê o produto da RAIZ do corpo (não existe envelope `dados`)', async () => {
    const { svc } = build([]);

    const r = await svc.responder(envio({ idMapeamento: '99', codigo: 'MB-05' }));

    expect(r).toEqual([{ idMapeamento: '99', skuMapeamento: 'MB-05' }]);
  });

  it('mantém os ids como STRING (o contrato é string; converter é risco à toa)', async () => {
    const { svc } = build([]);

    const r = await svc.responder(envio({ idMapeamento: 1304432, codigo: 'MB-01' }));

    expect(r[0].idMapeamento).toBe('1304432');
    expect(typeof r[0].idMapeamento).toBe('string');
  });

  it('o SKU sai do NOSSO catálogo, casando por codigoErp', async () => {
    // O código da loja pode divergir do código do ERP. Quem manda é o SKU que
    // o site usa na cotação e no pedido.
    const { svc } = build([{ codigoErp: '441393295', sku: 'MB-07' }]);

    const r = await svc.responder(
      envio({ id: '441393295', idMapeamento: '1', codigo: 'OUTRO-CODIGO' }),
    );

    expect(r[0].skuMapeamento).toBe('MB-07');
  });

  it('sem o produto no catálogo, cai no `codigo` do envio', async () => {
    const { svc } = build([]);

    const r = await svc.responder(envio({ id: '999', idMapeamento: '1', codigo: 'MB-03' }));

    expect(r[0].skuMapeamento).toBe('MB-03');
  });

  it('variações viram itens próprios, cada uma com o SEU idMapeamento', async () => {
    const { svc } = build([]);

    const r = await svc.responder(
      envio({
        id: '441393295',
        idMapeamento: '1304432',
        codigo: 'ex-pai',
        variacoes: [
          { id: '441393302', idMapeamento: '1304433', codigo: 'ex-pai-1' },
          { id: '441393310', idMapeamento: '1304434', codigo: 'ex-pai-2' },
        ],
      }),
    );

    expect(r).toEqual([
      { idMapeamento: '1304432', skuMapeamento: 'ex-pai' },
      { idMapeamento: '1304433', skuMapeamento: 'ex-pai-1' },
      { idMapeamento: '1304434', skuMapeamento: 'ex-pai-2' },
    ]);
  });

  it('produto que não dá pra mapear volta com ERRO explicado, não sumido', async () => {
    // O painel mostra esta mensagem pra quem clicou em "enviar". Omitir o item
    // faria o envio parecer bem-sucedido.
    const { svc } = build([]);

    const r = await svc.responder(envio({ id: '42', idMapeamento: '7', nome: 'Produto Fantasma' }));

    expect(r[0].idMapeamento).toBe('7');
    expect(r[0].skuMapeamento).toBeUndefined();
    expect(r[0].error).toContain('Produto Fantasma');
  });

  it('item sem idMapeamento não inventa chave', async () => {
    const { svc } = build([]);

    const r = await svc.responder(envio({ id: '42', codigo: 'MB-01' }));

    expect(r[0].error).toContain('idMapeamento');
  });

  it('com DUAS empresas conectadas não consulta catálogo — SKU errado é pior que genérico', async () => {
    const { svc, prisma } = build([{ codigoErp: '441393295', sku: 'MB-01' }], 2);

    const r = await svc.responder(
      envio({ id: '441393295', idMapeamento: '1', codigo: 'MB-01-DO-ENVIO' }),
    );

    expect(prisma.produto.findMany).not.toHaveBeenCalled();
    expect(r[0].skuMapeamento).toBe('MB-01-DO-ENVIO');
  });

  it('corpo ilegível não estoura — devolve lista vazia', async () => {
    const { svc } = build([]);

    expect(await svc.responder('não é json')).toEqual([]);
  });

  it('corpo vazio devolve lista vazia', async () => {
    const { svc } = build([]);

    expect(await svc.responder('null')).toEqual([]);
  });

  // O arquivo de exemplo da Olist mostra o produto SOZINHO; o envio real vem
  // embrulhado, como os outros webhooks do Tiny. Ler só a raiz devolvia um item
  // sem idMapeamento — e o painel repetia "não mapeado" sem dizer por quê.
  describe('envelope do webhook', () => {
    it('lê o produto dentro de `dados`', async () => {
      const { svc } = build([]);

      const r = await svc.responder(
        JSON.stringify({
          cnpj: '12345678000190',
          tipo: 'produto',
          versao: '1.0.0',
          dados: { id: '335240597', idMapeamento: '1304432', codigo: 'MB-01' },
        }),
      );

      expect(r).toEqual([{ idMapeamento: '1304432', skuMapeamento: 'MB-01' }]);
    });

    it('`dados` com vários produtos vira vários mapeamentos', async () => {
      const { svc } = build([]);

      const r = await svc.responder(
        JSON.stringify({
          dados: [
            { idMapeamento: '1', codigo: 'MB-01' },
            { idMapeamento: '2', codigo: 'MB-02' },
          ],
        }),
      );

      expect(r.map((m) => m.skuMapeamento)).toEqual(['MB-01', 'MB-02']);
    });

    it('produto na RAIZ continua funcionando (é o formato do arquivo de exemplo)', async () => {
      const { svc } = build([]);

      const r = await svc.responder(JSON.stringify({ idMapeamento: '9', codigo: 'MB-09' }));

      expect(r).toEqual([{ idMapeamento: '9', skuMapeamento: 'MB-09' }]);
    });

    it('envelope SEM produto não vira item com erro — seria ruído respondido como produto', async () => {
      const { svc } = build([]);

      expect(await svc.responder(JSON.stringify({ cnpj: '123', tipo: 'produto' }))).toEqual([]);
    });
  });
});
