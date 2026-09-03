import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyProdutosSyncService } from './tiny-produtos-sync.service';

/**
 * O sentido normal do dia a dia: o Tiny é a fonte da verdade e o app espelha.
 * A importação foi só o bootstrap de uma conta vazia.
 */
function build(produtos: unknown[] = [], existente: { id: string } | null = null) {
  const client = {
    get: vi.fn((_e: string, caminho: string) => {
      if (caminho.startsWith('/estoque/')) return Promise.resolve({ saldo: 10, disponivel: 7 });
      // Anexos devolvem ARRAY DIRETO — não `{ itens }` como o resto da API.
      if (caminho.includes('/anexos')) {
        return Promise.resolve([{ id: 1, url: 'https://cdn/mb-01.png', externo: false }]);
      }
      // Lista de preços: os produtos vêm em `excecoes`, não em `itens`.
      if (caminho === '/listas-precos') {
        return Promise.resolve({ itens: [{ id: 1701, descricao: 'Locação mensal' }] });
      }
      if (caminho.startsWith('/listas-precos/')) {
        return Promise.resolve({ excecoes: [{ idProduto: 335240597, preco: 300 }] });
      }
      return Promise.resolve({ itens: produtos, paginacao: { total: produtos.length } });
    }),
  };
  const prisma = {
    produto: {
      findFirst: vi.fn().mockResolvedValue(existente),
      create: vi.fn().mockResolvedValue({ id: 'p1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    integracaoConexao: { findFirst: vi.fn().mockResolvedValue({ ultimoSync: null }) },
  };
  const integracoes = { registrarSyncOk: vi.fn().mockResolvedValue(undefined) };
  const svc = new TinyProdutosSyncService(prisma as never, client as never, integracoes as never);
  return { svc, prisma, client, integracoes };
}

const MB = {
  id: 335240597,
  sku: 'MB-01',
  descricao: 'Master Block MB-01',
  situacao: 'A',
  unidade: 'UN',
  precos: { preco: 3150, precoCusto: 1800 },
};

describe('sync de produtos do Tiny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('produto novo é criado com preço e CUSTO REAL do ERP', async () => {
    // O custo deixou de ser o chute de 70% herdado do ERP.
    const { svc, prisma } = build([MB]);

    const r = await svc.sync('emp-1');

    const dados = prisma.produto.create.mock.calls[0][0].data;
    expect(dados.codigoErp).toBe('335240597');
    expect(Number(dados.precoTabela)).toBe(3150);
    expect(Number(dados.precoFabrica)).toBe(1800);
    expect(r.criados).toBe(1);
  });

  it('sem custo no ERP, precoFabrica fica NULL — não inventa', async () => {
    const { svc, prisma } = build([{ ...MB, precos: { preco: 3150 } }]);
    await svc.sync('emp-1');
    expect(prisma.produto.create.mock.calls[0][0].data.precoFabrica).toBeNull();
  });

  it('produto que já existe é atualizado, não duplicado', async () => {
    const { svc, prisma } = build([MB], { id: 'p-existente' });
    const r = await svc.sync('emp-1');
    expect(prisma.produto.update).toHaveBeenCalled();
    expect(prisma.produto.create).not.toHaveBeenCalled();
    expect(r.atualizados).toBe(1);
  });

  it('casa por codigoErp OU sku — produto que nasceu aqui antes da integração', async () => {
    const { svc, prisma } = build([MB], { id: 'p1' });
    await svc.sync('emp-1');
    const where = prisma.produto.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ codigoErp: '335240597' }, { sku: 'MB-01' }]);
  });

  it('estoque grava o DISPONÍVEL, não o saldo cru', async () => {
    // Saldo inclui peça já comprometida com outro pedido; prometer isso ao
    // cliente é vender o que não tem.
    const { svc, prisma } = build([MB]);
    await svc.sync('emp-1');
    const data = prisma.produto.updateMany.mock.calls[0][0].data;
    expect(data.estoque).toBe(7);
    expect(data.estoqueAtualizadoEm).toBeInstanceOf(Date);
  });

  it('o relógio do incremental é o INÍCIO do sync, não o fim', async () => {
    // Produto alterado no ERP durante a rodada cairia no buraco entre o cutoff
    // e um carimbo final — e a próxima rodada o pularia, em silêncio.
    const { svc, integracoes } = build([MB]);
    const antes = Date.now();

    await svc.sync('emp-1');

    const carimbo = integracoes.registrarSyncOk.mock.calls[0][2] as Date;
    expect(carimbo.getTime()).toBeGreaterThanOrEqual(antes);
    expect(carimbo.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('com erro na rodada, o relógio NÃO avança', async () => {
    // Avançar o cutoff depois de falhar esconderia o que ficou pra trás.
    const { svc, prisma, integracoes } = build([MB]);
    prisma.produto.create.mockRejectedValue(new Error('banco fora'));

    const r = await svc.sync('emp-1');

    expect(r.erros).toBe(1);
    expect(integracoes.registrarSyncOk).not.toHaveBeenCalled();
  });

  it('modo completo ignora o último sync e pede tudo', async () => {
    const { svc, client } = build([MB]);
    await svc.sync('emp-1', { modo: 'completo' });
    const query = client.get.mock.calls.find((c) => c[1] === '/produtos')?.[2] as Record<
      string,
      unknown
    >;
    expect(query.dataAlteracao).toBeUndefined();
    expect(query.situacao).toBe('A');
  });
});

describe('imagem do produto', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grava a URL da imagem vinda do ERP', async () => {
    const { svc, prisma } = build([MB]);

    await svc.sync('emp-1');

    // updateMany é usado por estoque E por imagem; a chamada da imagem é a que
    // carrega `imagem`.
    const chamadaImagem = prisma.produto.updateMany.mock.calls.find(
      (c) => (c[0] as { data: Record<string, unknown> }).data.imagem,
    );
    expect((chamadaImagem?.[0] as { data: { imagem: string } }).data.imagem).toBe(
      'https://cdn/mb-01.png',
    );
  });

  it('produto sem anexo não quebra o sync — só fica sem imagem', async () => {
    const { svc, client } = build([MB]);
    client.get.mockImplementation((_e: string, caminho: string) => {
      if (caminho.startsWith('/estoque/')) return Promise.resolve({ disponivel: 7 });
      if (caminho.includes('/anexos')) return Promise.resolve([]);
      return Promise.resolve({ itens: [MB], paginacao: { total: 1 } });
    });

    const r = await svc.sync('emp-1');

    expect(r.erros).toBe(0);
  });
});

describe('preço de locação', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lê a lista "Locação mensal" e grava a mensalidade no produto', async () => {
    // O detalhe da lista vem em `excecoes` — ler `itens` devolvia vazio, e
    // mensalidade vazia não parece bug, parece cadastro faltando.
    const { svc, prisma } = build([MB]);

    await svc.sync('emp-1');

    const dados = prisma.produto.create.mock.calls[0][0].data;
    expect(Number(dados.precoLocacaoMensal)).toBe(300);
  });

  it('produto fora da lista fica com locação NULL (não herda o preço de venda)', async () => {
    const { svc, prisma } = build([{ ...MB, id: 999999 }]);

    await svc.sync('emp-1');

    expect(prisma.produto.create.mock.calls[0][0].data.precoLocacaoMensal).toBeNull();
  });
});

/**
 * Passou a existir MAIS DE UMA lista de locacao (Padrao e + Data Sense, 02/09),
 * e cada produto aparece em exatamente uma. E a de PLACEHOLDER nao pode ser
 * apagada — a API do Tiny recusa DELETE em lista de preco — entao ela convive
 * com as reais e nao pode concorrer.
 */
describe('TinyProdutosSyncService — listas de locacao', () => {
  const clienteCom = (
    listas: Array<{ id: number; descricao: string }>,
    porLista: Record<number, Array<{ idProduto: number; preco: number }>>,
  ) => ({
    get: vi.fn((_e: string, caminho: string) => {
      if (caminho.startsWith('/estoque/')) return Promise.resolve({ saldo: 0, disponivel: 0 });
      if (caminho.includes('/anexos')) return Promise.resolve([]);
      if (caminho === '/listas-precos') return Promise.resolve({ itens: listas });
      const m = /\/listas-precos\/(\d+)/.exec(caminho);
      if (m) return Promise.resolve({ excecoes: porLista[Number(m[1])] ?? [] });
      return Promise.resolve({ itens: [], paginacao: { total: 0 } });
    }),
  });

  const mapaDe = async (cliente: unknown) => {
    // Ordem do construtor: (prisma, client, integracoes) — so o client importa aqui.
    const svc = new TinyProdutosSyncService({} as never, cliente as never, {} as never);
    // @ts-expect-error — metodo privado: e o alvo do teste
    return svc.precosDeLocacao('emp-1') as Promise<Map<number, number>>;
  };

  it('junta TODAS as listas de locacao — uma familia nao pode apagar a outra', async () => {
    const mapa = await mapaDe(
      clienteCom(
        [
          { id: 1769, descricao: 'Locação mensal — Master Block Padrão 2026' },
          { id: 1770, descricao: 'Locação mensal — Master Block + Data Sense 2026' },
        ],
        { 1769: [{ idProduto: 1, preco: 121 }], 1770: [{ idProduto: 2, preco: 564 }] },
      ),
    );

    expect(mapa.get(1)).toBe(121);
    expect(mapa.get(2)).toBe(564);
  });

  it('IGNORA a lista de PLACEHOLDER — ela nao pode ser apagada e concorreria com o preco real', async () => {
    const mapa = await mapaDe(
      clienteCom(
        [
          { id: 1701, descricao: 'Locação mensal (PLACEHOLDER — valores a confirmar)' },
          { id: 1769, descricao: 'Locação mensal — Master Block Padrão 2026' },
        ],
        { 1701: [{ idProduto: 1, preco: 300 }], 1769: [{ idProduto: 1, preco: 121 }] },
      ),
    );

    expect(mapa.get(1)).toBe(121);
  });

  it('sem lista nenhuma, devolve vazio em vez de estourar', async () => {
    const mapa = await mapaDe(clienteCom([], {}));

    expect(mapa.size).toBe(0);
  });

  it('imagem = o anexo MAIS RECENTE — a API do Tiny não deleta anexo, só empilha', async () => {
    const { svc, prisma, client } = build([MB]);
    client.get.mockImplementation((_e: string, caminho: string) => {
      if (caminho.startsWith('/estoque/')) return Promise.resolve({ disponivel: 7 });
      if (caminho.includes('/anexos'))
        return Promise.resolve([
          { id: 1, url: 'https://cdn/velho.png' },
          { id: 2, url: 'https://cdn/novo.png' },
        ]);
      return Promise.resolve({ itens: [MB], paginacao: { total: 1 } });
    });

    await svc.sync('emp-1');

    const chamada = prisma.produto.updateMany.mock.calls.find(
      (c) => (c[0] as { data: Record<string, unknown> }).data.imagem,
    );
    expect((chamada?.[0] as { data: { imagem: string } }).data.imagem).toBe('https://cdn/novo.png');
  });

  it('429 na busca do anexo não passa por "sem imagem" — tenta de novo e conta a falha', async () => {
    const { svc, prisma, client } = build([MB]);
    let tentativas = 0;
    client.get.mockImplementation((_e: string, caminho: string) => {
      if (caminho.startsWith('/estoque/')) return Promise.resolve({ disponivel: 7 });
      if (caminho.includes('/anexos')) {
        tentativas += 1;
        if (tentativas === 1) return Promise.reject(new Error('Tiny HTTP 429'));
        return Promise.resolve([{ id: 9, url: 'https://cdn/depois-do-429.png' }]);
      }
      return Promise.resolve({ itens: [MB], paginacao: { total: 1 } });
    });

    const r = await svc.sync('emp-1');

    expect(r.imagensFalharam).toBe(0);
    const chamada = prisma.produto.updateMany.mock.calls.find(
      (c) => (c[0] as { data: Record<string, unknown> }).data.imagem,
    );
    expect((chamada?.[0] as { data: { imagem: string } }).data.imagem).toBe(
      'https://cdn/depois-do-429.png',
    );
  });

  it('imagem que não veio mesmo depois do retry aparece no resultado — "0 erros" não pode esconder', async () => {
    const { svc, client } = build([MB]);
    client.get.mockImplementation((_e: string, caminho: string) => {
      if (caminho.startsWith('/estoque/')) return Promise.resolve({ disponivel: 7 });
      if (caminho.includes('/anexos')) return Promise.reject(new Error('Tiny HTTP 500'));
      return Promise.resolve({ itens: [MB], paginacao: { total: 1 } });
    });

    const r = await svc.sync('emp-1');

    expect(r.erros).toBe(0);
    expect(r.imagensFalharam).toBe(1);
  });
});
