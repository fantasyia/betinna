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
  // O contato é resolvido pelo TinyContatosService (mesma regra usada pelo
  // cadastro de rep) — aqui ele é mock: o alvo do teste é o PEDIDO.
  // O contato é resolvido pelo TinyContatosService (a MESMA regra que o cadastro
  // de rep usa). Aqui ele é mock: o alvo destes testes é o PEDIDO.
  const svcContatos = { garantir: vi.fn().mockResolvedValue(894881870) };
  return {
    svc: new TinyPedidosService(client as never, svcContatos as never),
    client,
    svcContatos,
    pedidoPost,
  };
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

  // O teste antigo afirmava `corpo.numeroPedidoEcommerce` no TOPO — e passava,
  // porque conferia o formato que a gente inventou em vez do que o Tiny pede.
  // O Tiny aceita a requisição com campo desconhecido no topo e DESCARTA em
  // silêncio: o pedido nascia sem número de e-commerce e ninguém achava a
  // venda pelo número que o cliente diz. O contrato é `ecommerce: { … }`.
  it('o número do pedido do site vai ANINHADO em ecommerce (solto no topo, o Tiny descarta)', async () => {
    const { svc, pedidoPost } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', pedido);
    const corpo = pedidoPost()[2] as unknown as {
      ecommerce?: { numeroPedidoEcommerce?: string };
      numeroPedidoEcommerce?: string;
    };
    expect(corpo.ecommerce?.numeroPedidoEcommerce).toBe('SOM-2026-0001');
    expect(corpo.numeroPedidoEcommerce).toBeUndefined();
  });

  it('amarra o pedido ao canal quando o tenant tem e-commerce cadastrado', async () => {
    const { svc, pedidoPost } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', { ...pedido, ecommerceId: 77 });
    const corpo = pedidoPost()[2] as unknown as { ecommerce?: { id?: number } };
    expect(corpo.ecommerce?.id).toBe(77);
  });

  it('sem canal cadastrado o pedido entra igual — só sem amarração', async () => {
    const { svc, pedidoPost } = build([{ id: 42, sku: 'MB-01' }]);
    await svc.criar('emp-1', pedido);
    const corpo = pedidoPost()[2] as unknown as { ecommerce?: { id?: number } };
    expect(corpo.ecommerce?.id).toBeUndefined();
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

  // A regra de achar-ou-criar (documento antes de nome, F/J pelo tamanho) mora
  // no TinyContatosService e é testada lá — porque o cadastro de REPRESENTANTE
  // usa a mesma. Duas cópias da dedup significam duas verdades, e a que errar
  // cria o contato duplicado.
  it('delega a resolução do contato e usa o id no pedido', async () => {
    const { svc, svcContatos, pedidoPost } = build([{ id: 42, sku: 'MB-01' }]);

    await svc.criar('emp-1', {
      cliente: { nome: 'Somatec', cpfCnpj: '12345678900099', email: 'a@b.c' },
      itens: [{ sku: 'MB-01', quantidade: 1 }],
    });

    expect(svcContatos.garantir).toHaveBeenCalledWith('emp-1', {
      nome: 'Somatec',
      cpfCnpj: '12345678900099',
      email: 'a@b.c',
      telefone: undefined,
    });
    expect((pedidoPost()[2] as unknown as { idContato: number }).idContato).toBe(894881870);
  });

  it('contato que falha derruba o pedido — melhor não criar do que criar sem dono', async () => {
    const { svc, svcContatos, client } = build([{ id: 42, sku: 'MB-01' }]);
    svcContatos.garantir.mockRejectedValueOnce(new Error('contato inválido'));

    await expect(
      svc.criar('emp-1', {
        cliente: { nome: 'X' },
        itens: [{ sku: 'MB-01', quantidade: 1 }],
      }),
    ).rejects.toThrow(/contato/i);
    expect(client.post.mock.calls.some((c) => c[1] === '/pedidos')).toBe(false);
  });
});
