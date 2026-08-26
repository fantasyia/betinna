import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyPedidosService } from './tiny-pedidos.service';

/**
 * Criar pedido é onde a venda sai do nosso lado e entra no ERP. Daí em diante
 * o ERP manda — separação, nota, etiqueta e rastreio acontecem lá. Errar aqui
 * não dá tela vermelha: dá nota errada.
 */
function build(
  produtos: Array<{ id: number; sku: string }> = [],
  contatos: Array<{ id: number; nome?: string; cpfCnpj?: string }> = [],
) {
  const client = {
    get: vi.fn((_e: string, caminho: string) =>
      Promise.resolve({ itens: caminho.startsWith('/contatos') ? contatos : produtos }),
    ),
    // POST atende dois recursos: /contatos (cliente) e /pedidos (a venda).
    post: vi.fn((_e: string, caminho: string) =>
      Promise.resolve(caminho === '/contatos' ? { id: 555 } : { id: 900, numeroPedido: 1 }),
    ),
  };
  const pedidoPost = () =>
    client.post.mock.calls.find((c) => c[1] === '/pedidos') as [
      string,
      string,
      Record<string, unknown>,
    ];
  return { svc: new TinyPedidosService(client as never), client, pedidoPost };
}

const pedido = {
  cliente: { nome: 'Cliente Teste', cpfCnpj: '12345678909' },
  itens: [{ sku: 'MB-01', quantidade: 2, valorUnitario: 3150 }],
  numeroPedidoEcommerce: 'SOM-2026-0001',
  valorFrete: 0,
};

describe('criar pedido no Tiny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolve o item por SKU e manda o id do ERP', async () => {
    const { svc, pedidoPost } = build([{ id: 42, sku: 'MB-01' }]);

    const r = await svc.criar('emp-1', pedido);

    const corpo = pedidoPost()[2] as unknown as { itens: unknown[] };
    expect(corpo.itens).toEqual([{ produto: { id: 42 }, quantidade: 2, valorUnitario: 3150 }]);
    expect(r.id).toBe(900);
  });

  it('SKU inexistente NÃO cria pedido pela metade', async () => {
    // Pedido com item faltando vira nota errada — problema fiscal, não bug.
    const { svc, client } = build([]);

    await expect(svc.criar('emp-1', pedido)).rejects.toThrow(/não existe no Tiny/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('a busca por código é conferida com igualdade exata', async () => {
    // O filtro `codigo` do Tiny casaria MB-01 dentro de MB-010 — venderia o
    // produto errado.
    const { svc, client } = build([{ id: 10, sku: 'MB-010' }]);

    await expect(svc.criar('emp-1', pedido)).rejects.toThrow(/não existe/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('nasce na situação ABERTA — não cabe a nós declarar aprovado', async () => {
    const { svc, pedidoPost } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', pedido);
    expect((pedidoPost()[2] as unknown as { situacao: number }).situacao).toBe(0);
  });

  it('leva o número do pedido do SITE — é por ele que o webhook casa de volta', async () => {
    const { svc, pedidoPost } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', pedido);
    const corpo = pedidoPost()[2] as unknown as { numeroPedidoEcommerce: string };
    expect(corpo.numeroPedidoEcommerce).toBe('SOM-2026-0001');
  });

  it('frete grátis vai como 0, não some do payload', async () => {
    // `valorFrete: 0` é informação (o cliente não pagou), não ausência de dado.
    const { svc, pedidoPost } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', pedido);
    expect((pedidoPost()[2] as unknown as { valorFrete: number }).valorFrete).toBe(0);
  });

  it('depósito e vendedor só vão quando existem', async () => {
    const { svc, pedidoPost } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', { ...pedido, depositoId: 7 });
    const corpo = pedidoPost()[2] as unknown as Record<string, unknown>;
    expect(corpo.deposito).toEqual({ id: 7 });
    expect(corpo.vendedor).toBeUndefined();
  });
});

/**
 * O Tiny exige `idContato`: cliente é CADASTRO, não texto no pedido — é o
 * mesmo contato que recebe nota, cobrança e histórico. Descoberto na primeira
 * tentativa real (26/08: "idContato: Campo obrigatório").
 */
describe('contato do cliente', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reaproveita contato existente pelo CPF/CNPJ, sem criar duplicado', async () => {
    const { svc, client, pedidoPost } = build(
      [{ id: 42, sku: 'MB-01' }],
      [{ id: 77, cpfCnpj: '12.345.678/9000-99' }],
    );

    await svc.criar('emp-1', {
      cliente: { nome: 'Somatec', cpfCnpj: '12345678900099' },
      itens: [{ sku: 'MB-01', quantidade: 1 }],
    });

    expect(client.post.mock.calls.some((c) => c[1] === '/contatos')).toBe(false);
    expect((pedidoPost()[2] as unknown as { idContato: number }).idContato).toBe(77);
  });

  it('cria o contato quando não existe e usa o id novo no pedido', async () => {
    const { svc, client, pedidoPost } = build([{ id: 42, sku: 'MB-01' }], []);

    await svc.criar('emp-1', {
      cliente: { nome: 'Cliente Novo', cpfCnpj: '12345678909' },
      itens: [{ sku: 'MB-01', quantidade: 1 }],
    });

    const contato = client.post.mock.calls.find((c) => c[1] === '/contatos');
    // 11 dígitos = pessoa física; 14 seria jurídica.
    expect((contato?.[2] as { tipoPessoa: string }).tipoPessoa).toBe('F');
    expect((pedidoPost()[2] as unknown as { idContato: number }).idContato).toBe(555);
  });

  it('CNPJ (14 dígitos) entra como pessoa jurídica', async () => {
    const { svc, client } = build([{ id: 42, sku: 'MB-01' }], []);
    await svc.criar('emp-1', {
      cliente: { nome: 'Empresa', cpfCnpj: '12.345.678/0001-99' },
      itens: [{ sku: 'MB-01', quantidade: 1 }],
    });
    const contato = client.post.mock.calls.find((c) => c[1] === '/contatos');
    expect((contato?.[2] as { tipoPessoa: string }).tipoPessoa).toBe('J');
  });
});
