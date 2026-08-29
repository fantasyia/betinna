import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropostaErpService } from './proposta-erp.service';

/**
 * A proposta subindo pro ERP.
 *
 * O que os testes protegem: o cliente aprova um PDF, e o pedido que nasce lá
 * precisa ser o mesmo documento. Divergência de valor, proposta duplicada e
 * vendedor faltando são os três jeitos de isso quebrar em produção.
 */
const PROPOSTA = {
  id: 'p-1',
  numero: 'PROP-0007',
  status: 'ENVIADA',
  orcamentoErpId: null,
  validoAte: null,
  prazoEntrega: null,
  condicaoPagamento: '30/60',
  observacoes: 'entrega no galpão 2',
  cliente: { nome: 'Indústria X', cnpj: '16774052000155', email: null, telefone: null },
  itens: [{ produtoId: 'prod-1', produtoNome: 'MB-01', quantidade: 2, total: 3000 }],
  representante: { nome: 'Marcelo Harada', contatoErpId: '894881870' },
};

function build(opts: { proposta?: Record<string, unknown> | null; vendedor?: number | null } = {}) {
  const prisma = {
    proposta: {
      findFirst: vi.fn().mockResolvedValue(opts.proposta === undefined ? PROPOSTA : opts.proposta),
      update: vi.fn().mockResolvedValue({}),
    },
    produto: {
      findMany: vi.fn().mockResolvedValue([{ id: 'prod-1', sku: 'MB-01', nome: 'MB-01' }]),
    },
  };
  const orcamentos = { criar: vi.fn().mockResolvedValue({ id: 4242, numeroProposta: '12' }) };
  const contatos = {
    acharVendedorPorContato: vi
      .fn()
      .mockResolvedValue(opts.vendedor === undefined ? 555 : opts.vendedor),
  };
  const svc = new PropostaErpService(prisma as never, orcamentos as never, contatos as never);
  return { svc, prisma, orcamentos, contatos };
}

describe('proposta → orçamento no ERP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('manda o unitário JÁ com desconto (o preço que o cliente leu)', async () => {
    // 3000 de total em 2 unidades = 1500 cada. Mandar o preço cheio + desconto
    // separado faz o total do ERP divergir do PDF aprovado.
    const { svc, orcamentos } = build();

    await svc.enviar('p-1', 'emp-1');

    const corpo = orcamentos.criar.mock.calls[0][1];
    expect(corpo.itens).toEqual([{ sku: 'MB-01', quantidade: 2, valorUnitario: 1500 }]);
    expect(corpo.vendedorId).toBe(555);
  });

  it('guarda o id do orçamento (é o que impede a proposta duplicada)', async () => {
    const { svc, prisma } = build();

    const r = await svc.enviar('p-1', 'emp-1');

    expect(prisma.proposta.update.mock.calls[0][0].data.orcamentoErpId).toBe('4242');
    expect(r.numeroProposta).toBe('12');
  });

  it('proposta que já subiu NÃO sobe de novo', async () => {
    const { svc, orcamentos } = build({ proposta: { ...PROPOSTA, orcamentoErpId: '99' } });

    await expect(svc.enviar('p-1', 'emp-1')).rejects.toThrow(/já está no ERP/i);
    expect(orcamentos.criar).not.toHaveBeenCalled();
  });

  it('rep que ainda não é VENDEDOR no painel para antes de chamar o Tiny', async () => {
    // O orçamento EXIGE vendedor; sem esta mensagem o erro vira um 400 cru que
    // não diz onde resolver.
    const { svc, orcamentos } = build({ vendedor: null });

    await expect(svc.enviar('p-1', 'emp-1')).rejects.toThrow(/ainda NÃO é vendedor/i);
    expect(orcamentos.criar).not.toHaveBeenCalled();
  });

  it('rep sem contato no ERP explica que falta o cadastro, não o vendedor', async () => {
    const { svc } = build({
      proposta: {
        ...PROPOSTA,
        representante: { nome: 'Rep Novo', contatoErpId: null },
      },
    });

    await expect(svc.enviar('p-1', 'emp-1')).rejects.toThrow(/ainda não é contato no ERP/i);
  });

  it('rascunho não sobe', async () => {
    const { svc } = build({ proposta: { ...PROPOSTA, status: 'RASCUNHO' } });

    await expect(svc.enviar('p-1', 'emp-1')).rejects.toThrow(/rascunho/i);
  });
});
