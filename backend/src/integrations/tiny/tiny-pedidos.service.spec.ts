import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyPedidosService } from './tiny-pedidos.service';

/**
 * Criar pedido é onde a venda sai do nosso lado e entra no ERP. Daí em diante
 * o ERP manda — separação, nota, etiqueta e rastreio acontecem lá. Errar aqui
 * não dá tela vermelha: dá nota errada.
 */
function build(produtos: Array<{ id: number; sku: string }> = []) {
  const client = {
    get: vi.fn().mockResolvedValue({ itens: produtos }),
    post: vi.fn().mockResolvedValue({ id: 900, numeroPedido: 1 }),
  };
  return { svc: new TinyPedidosService(client as never), client };
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
    const { svc, client } = build([{ id: 42, sku: 'MB-01' }]);

    const r = await svc.criar('emp-1', pedido);

    const corpo = client.post.mock.calls[0][2] as { itens: unknown[] };
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
    const { svc, client } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', pedido);
    expect((client.post.mock.calls[0][2] as { situacao: number }).situacao).toBe(0);
  });

  it('leva o número do pedido do SITE — é por ele que o webhook casa de volta', async () => {
    const { svc, client } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', pedido);
    const corpo = client.post.mock.calls[0][2] as { numeroPedidoEcommerce: string };
    expect(corpo.numeroPedidoEcommerce).toBe('SOM-2026-0001');
  });

  it('frete grátis vai como 0, não some do payload', async () => {
    // `valorFrete: 0` é informação (o cliente não pagou), não ausência de dado.
    const { svc, client } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', pedido);
    expect((client.post.mock.calls[0][2] as { valorFrete: number }).valorFrete).toBe(0);
  });

  it('depósito e vendedor só vão quando existem', async () => {
    const { svc, client } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', { ...pedido, depositoId: 7 });
    const corpo = client.post.mock.calls[0][2] as Record<string, unknown>;
    expect(corpo.deposito).toEqual({ id: 7 });
    expect(corpo.vendedor).toBeUndefined();
  });
});
