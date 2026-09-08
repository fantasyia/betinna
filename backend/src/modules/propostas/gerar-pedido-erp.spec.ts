import { describe, expect, it, vi } from 'vitest';
import { PropostaErpService } from './proposta-erp.service';

/**
 * Orçamento aprovado → pedido de venda, sem redigitar.
 *
 * O passo existia à mão: alguém abria o orçamento aprovado no Tiny e relançava
 * os itens como pedido. Relançar é onde o valor diverge do que o cliente
 * aprovou — e a divergência só aparece na nota.
 *
 * O que estes testes protegem é o inverso do óbvio: as RECUSAS. O Tiny gera um
 * pedido novo a cada chamada de `/orcamentos/{id}/venda`, sem reclamar da
 * segunda — a trava do duplicado é nossa, e um pedido duplicado só aparece na
 * hora de faturar.
 */
const build = (
  proposta: Record<string, unknown> | null = {
    id: 'p1',
    numero: 'PROP-1',
    status: 'ACEITA',
    orcamentoErpId: '900',
    pedidoErpId: null,
    cliente: { nome: 'Indústria X' },
  },
) => {
  const prisma = {
    proposta: {
      findFirst: vi.fn().mockResolvedValue(proposta),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const orcamentos = {
    gerarVenda: vi.fn().mockResolvedValue({ id: 555, numeroPedido: '1042' }),
  };
  const notificacoes = { criarParaRole: vi.fn().mockResolvedValue(undefined) };
  const svc = new PropostaErpService(
    prisma as never,
    orcamentos as never,
    {} as never,
    notificacoes as never,
  );
  return { svc, prisma, orcamentos, notificacoes };
};

describe('gerar pedido a partir do orçamento aprovado', () => {
  it('chama o ERP e guarda o pedido gerado', async () => {
    const { svc, prisma, orcamentos } = build();

    const r = await svc.gerarPedido('p1', 'emp-1');

    expect(orcamentos.gerarVenda).toHaveBeenCalledWith('emp-1', 900);
    expect(r).toMatchObject({ pedidoErpId: '555', numeroPedido: '1042' });
    expect(prisma.proposta.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pedidoErpId: '555' }) }),
    );
  });

  it('a SEGUNDA chamada é recusada — o ERP criaria um pedido duplicado', async () => {
    const { svc, orcamentos } = build({
      id: 'p1',
      numero: 'PROP-1',
      status: 'ACEITA',
      orcamentoErpId: '900',
      pedidoErpId: '555',
      cliente: { nome: 'Indústria X' },
    });

    await expect(svc.gerarPedido('p1', 'emp-1')).rejects.toThrow(/já virou o pedido 555/i);
    expect(orcamentos.gerarVenda).not.toHaveBeenCalled();
  });

  it('proposta que o cliente NÃO aceitou não vira pedido', async () => {
    // Gerar pedido de negócio em negociação cria demanda de faturamento pra
    // algo que o cliente ainda pode recusar.
    const { svc, orcamentos } = build({
      id: 'p1',
      numero: 'PROP-1',
      status: 'NEGOCIACAO',
      orcamentoErpId: '900',
      pedidoErpId: null,
      cliente: { nome: 'Indústria X' },
    });

    await expect(svc.gerarPedido('p1', 'emp-1')).rejects.toThrow(/ACEITA/);
    expect(orcamentos.gerarVenda).not.toHaveBeenCalled();
  });

  it('proposta que nem subiu pro ERP explica o passo que falta', async () => {
    const { svc } = build({
      id: 'p1',
      numero: 'PROP-1',
      status: 'ACEITA',
      orcamentoErpId: null,
      pedidoErpId: null,
      cliente: { nome: 'Indústria X' },
    });

    await expect(svc.gerarPedido('p1', 'emp-1')).rejects.toThrow(/Enviar para o ERP/i);
  });

  it('ERP sem devolver o pedido NÃO grava nada — senão a trava mente', async () => {
    // Gravar um id vazio deixaria a proposta travada pra sempre, com um pedido
    // que ninguém consegue achar no painel.
    const { svc, prisma, orcamentos } = build();
    orcamentos.gerarVenda.mockResolvedValue({});

    await expect(svc.gerarPedido('p1', 'emp-1')).rejects.toThrow(/não devolveu o pedido/i);
    expect(prisma.proposta.update).not.toHaveBeenCalled();
  });

  it('falha da notificação não desfaz o pedido já criado no ERP', async () => {
    const { svc, notificacoes } = build();
    notificacoes.criarParaRole.mockRejectedValue(new Error('redis fora'));

    await expect(svc.gerarPedido('p1', 'emp-1')).resolves.toMatchObject({ pedidoErpId: '555' });
  });
});
