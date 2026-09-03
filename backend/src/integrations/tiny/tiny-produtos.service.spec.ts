import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyProdutosService } from './tiny-produtos.service';

/**
 * Subir catálogo pro ERP é escrita em sistema fiscal — os cuidados aqui não são
 * teóricos: catálogo duplicado contamina pedido, estoque e nota; NCM ou custo
 * inventado vira problema fiscal e margem mentirosa.
 */
function build(existentes: Array<{ id: number; sku: string }> = []) {
  const client = {
    get: vi.fn().mockResolvedValue({ itens: existentes }),
    post: vi.fn().mockResolvedValue({ id: 999 }),
    put: vi.fn().mockResolvedValue({}),
  };
  return { svc: new TinyProdutosService(client as never), client };
}

const MB04 = {
  sku: 'MB-04',
  descricao: 'Master Block MB-04',
  preco: 7040,
  comprimentoCm: 20,
  larguraCm: 10,
  alturaCm: 7,
  pesoKg: 2,
  fichaTecnica: 'Corrente de carga: 400 – 500 A',
};

describe('importar produtos pro Tiny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SKU novo é CRIADO como Simples — o Tiny recusa Fabricado sem estrutura', async () => {
    // Tentativa real de 26/08: tipo F devolveu 400 "deve conter informações de
    // produção". A estrutura (lista de componentes) teria que vir junto, e
    // inventá-la seria inventar como a fábrica monta o produto.
    const { svc, client } = build([]);

    const r = await svc.importar('emp-1', [MB04]);

    expect(client.post).toHaveBeenCalledTimes(1);
    const corpo = client.post.mock.calls[0][2] as Record<string, unknown>;
    expect(corpo.tipo).toBe('S');
    expect(corpo.sku).toBe('MB-04');
    expect(r.criados).toBe(1);
  });

  it('quem quiser Fabricado pede explicitamente (com a estrutura pronta lá)', async () => {
    const { svc, client } = build([]);
    await svc.importar('emp-1', [{ ...MB04, tipo: 'F' as const }]);
    expect((client.post.mock.calls[0][2] as Record<string, unknown>).tipo).toBe('F');
  });

  it('429 na escrita não vira item faltando: espera e tenta de novo', async () => {
    // O teto de ESCRITA do Tiny é apertado — 12 POSTs seguidos tomaram 429 na
    // primeira importação real. Limite de taxa é "agora não", não "não".
    const { svc, client } = build([]);
    client.post.mockRejectedValueOnce(new Error('Tiny POST /produtos HTTP 429: '));

    const r = await svc.importar('emp-1', [MB04]);

    expect(client.post).toHaveBeenCalledTimes(2);
    expect(r.criados).toBe(1);
  });

  it('SKU que já existe é ATUALIZADO — rodar duas vezes não duplica catálogo', async () => {
    const { svc, client } = build([{ id: 42, sku: 'MB-04' }]);

    const r = await svc.importar('emp-1', [MB04]);

    expect(client.post).not.toHaveBeenCalled();
    expect(client.put).toHaveBeenCalledWith('emp-1', '/produtos/42', expect.anything());
    expect(r.atualizados).toBe(1);
  });

  it('a busca por código é BUSCA, não igualdade — confere o SKU exato', async () => {
    // O filtro `codigo` do Tiny casaria MB-01 dentro de MB-010. Sem a
    // conferência exata, atualizaríamos o produto ERRADO.
    const { svc, client } = build([{ id: 10, sku: 'MB-040' }]);

    await svc.importar('emp-1', [MB04]);

    expect(client.put).not.toHaveBeenCalled();
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it('sem custo real, o campo NÃO é enviado (custo chutado = margem mentirosa)', async () => {
    const { svc, client } = build([]);

    await svc.importar('emp-1', [MB04]);

    const corpo = client.post.mock.calls[0][2] as { precos: Record<string, number> };
    expect(corpo.precos).toEqual({ preco: 7040 });
    expect(corpo.precos.precoCusto).toBeUndefined();
  });

  it('peso e dimensões vão preenchidos — é o que o Melhor Envio usa pra cotar', async () => {
    const { svc, client } = build([]);

    await svc.importar('emp-1', [MB04]);

    const corpo = client.post.mock.calls[0][2] as { dimensoes: Record<string, number> };
    expect(corpo.dimensoes).toEqual({
      comprimento: 20,
      largura: 10,
      altura: 7,
      pesoLiquido: 2,
      pesoBruto: 2,
    });
  });

  it('sob encomenda por padrão: saldo zero não pode barrar venda de fabricado', async () => {
    const { svc, client } = build([]);
    await svc.importar('emp-1', [MB04]);
    const corpo = client.post.mock.calls[0][2] as { estoque: Record<string, boolean> };
    expect(corpo.estoque).toEqual({ controlar: true, sobEncomenda: true });
  });

  it('um SKU que falha não interrompe os outros, e o relatório diz qual', async () => {
    const { svc, client } = build([]);
    client.post.mockRejectedValueOnce(new Error('HTTP 400: ncm inválido'));

    const r = await svc.importar('emp-1', [
      MB04,
      { sku: 'MB-05', descricao: 'Master Block MB-05' },
    ]);

    expect(r.erros).toBe(1);
    expect(r.criados).toBe(1);
    expect(r.itens[0]).toMatchObject({ sku: 'MB-04', acao: 'erro' });
  });
});

/**
 * Embalagem e estrutura de produção — pedidos do Léo em 26/08, os dois com
 * razão de negócio: a CAIXA é o que o frete cobra (cada modelo tem peso e
 * tamanho diferentes), e produto fabricado é o que aceita ordem de produção.
 */
describe('embalagem e produto fabricado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('embalagem vai junto das dimensões (2 = pacote/caixa)', async () => {
    const { svc, client } = build([]);

    await svc.importar('emp-1', [{ ...MB04, embalagemTipo: 2 as const, embalagemId: 77 }]);

    const corpo = client.post.mock.calls[0][2] as { dimensoes: { embalagem: unknown } };
    expect(corpo.dimensoes.embalagem).toEqual({ tipo: 2, id: 77 });
  });

  it('produto FABRICADO nasce com a producao no MESMO POST', async () => {
    // Medido contra o Tiny em 02/09 — o caminho de dois passos NAO existe:
    //   POST tipo F sem `producao`       -> 400 "deve conter informacoes de producao"
    //   POST sem tipo, depois /fabricado -> 404 "produto nao e do tipo Fabricado"
    //   POST tipo F COM `producao`       -> 201, nasce F com a estrutura
    // O PUT de produto responde 204 e IGNORA `tipo`/`producao` em silencio, que
    // e o que fazia o antigo "nasce S e converte depois" parecer funcionar.
    const client = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ itens: [] }) // MB-04 ainda nao existe
        .mockResolvedValue({ itens: [{ id: 500, sku: 'MP-TESTE' }] }), // o componente existe
      post: vi.fn().mockResolvedValue({ id: 999 }),
      put: vi.fn().mockResolvedValue({}),
    };
    const svc = new TinyProdutosService(client as never);

    const r = await svc.importar('emp-1', [
      { ...MB04, componentes: [{ sku: 'MP-TESTE', quantidade: 1 }], etapas: ['Montagem'] },
    ]);

    const corpo = client.post.mock.calls[0][2] as Record<string, unknown>;
    expect(corpo.tipo).toBe('F');
    expect(corpo.producao).toEqual({
      produtos: [{ produto: { id: 500 }, quantidade: 1 }],
      etapas: ['Montagem'],
    });
    expect(r.itens[0].estrutura).toBe('definida');
    // Nada de PUT /fabricado na criacao — era ele que dava 404.
    expect(client.put).not.toHaveBeenCalled();
  });

  it('componente inexistente NAO cria o produto — fabricado sem estrutura o Tiny recusa', async () => {
    // Antes o produto entrava como Simples e so a estrutura falhava. Isso nao e
    // mais possivel: o que foi PEDIDO era um fabricado, e fabricado sem
    // estrutura o Tiny nao aceita. Criar um Simples no lugar seria entregar
    // outra coisa calado — a peca apareceria no catalogo sem virar ordem de
    // producao, e ninguem veria motivo.
    const client = {
      get: vi.fn().mockResolvedValue({ itens: [] }),
      post: vi.fn().mockResolvedValue({ id: 999 }),
      put: vi.fn().mockResolvedValue({}),
    };
    const svc = new TinyProdutosService(client as never);

    const r = await svc.importar('emp-1', [
      { ...MB04, componentes: [{ sku: 'NAO-EXISTE', quantidade: 1 }] },
    ]);

    expect(r.itens[0].acao).toBe('erro');
    // O relatorio diz POR QUE: "erro" sozinho manda quem le cacar no log.
    expect(r.itens[0].erro).toContain('NAO-EXISTE');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('produto EXCLUIDO (situacao E) nao conta como existente — o SKU volta a ficar livre', async () => {
    // O DELETE do Tiny e logico: marca E, o registro continua na busca e o SKU
    // fica livre. Sem descartar o cadaver, a importacao faria UPDATE nele.
    const client = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ itens: [{ id: 111, sku: 'MB-04', situacao: 'E' }] })
        .mockResolvedValue({ itens: [{ id: 500, sku: 'MP-TESTE' }] }),
      post: vi.fn().mockResolvedValue({ id: 999 }),
      put: vi.fn().mockResolvedValue({}),
    };
    const svc = new TinyProdutosService(client as never);

    const r = await svc.importar('emp-1', [
      { ...MB04, componentes: [{ sku: 'MP-TESTE', quantidade: 1 }] },
    ]);

    expect(r.itens[0].acao).toBe('criado');
  });

  it('sem componentes, nenhuma chamada de estrutura acontece', async () => {
    const { svc, client } = build([]);
    await svc.importar('emp-1', [MB04]);
    expect(client.put).not.toHaveBeenCalled();
  });
});

/**
 * Venda × locação: o Master Block é o MESMO produto (mesmo estoque, mesma
 * ficha técnica, mesma OP) com preço diferente. No Tiny isso é lista de preços.
 */
describe('lista de preços (locação)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolve os SKUs e cria a lista com os ids do Tiny', async () => {
    const { svc, client } = build([{ id: 42, sku: 'MB-01' }]);
    client.post.mockResolvedValue({ id: 7 });

    const r = await svc.definirListaPreco('emp-1', {
      descricao: 'Locação mensal',
      itens: [{ sku: 'MB-01', preco: 300 }],
    });

    expect(client.post).toHaveBeenCalledWith('emp-1', '/listas-precos', {
      descricao: 'Locação mensal',
      itens: [{ idProduto: 42, preco: 300 }],
    });
    expect(r.id).toBe(7);
  });

  it('SKU inexistente é reportado e NÃO entra na lista', async () => {
    // Lista com produto errado é pior que lista incompleta: alguém venderia
    // pelo preço de outro item.
    const { svc, client } = build([]);
    client.post.mockResolvedValue({ id: 7 });

    const r = await svc.definirListaPreco('emp-1', {
      descricao: 'Locação mensal',
      itens: [{ sku: 'NAO-EXISTE', preco: 300 }],
    });

    expect(r.itens[0].erro).toContain('não existe');
    expect(client.post).toHaveBeenCalledWith('emp-1', '/listas-precos', {
      descricao: 'Locação mensal',
      itens: [],
    });
  });
});
