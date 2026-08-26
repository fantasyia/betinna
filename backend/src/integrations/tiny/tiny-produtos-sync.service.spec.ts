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
    // O custo deixou de ser o chute de 70% herdado do OMIE.
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
