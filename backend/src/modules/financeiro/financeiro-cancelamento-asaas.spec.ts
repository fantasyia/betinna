import { describe, expect, it, vi } from 'vitest';
import { FinanceiroAutomaticoService } from './financeiro-automatico.service';

/**
 * Pedido cancelado com recebimento (Léo, 07/11, opção b): estorna sozinho só
 * quando o Asaas NÃO confirma o dinheiro. O resto continua com quem cancela.
 */
function montar(opts: {
  baixas?: Array<{ usuarioId: string | null; conta: string }>;
  pagamentos?: string[];
  cobranca?: unknown;
  erroAsaas?: boolean;
  semIntegracao?: boolean;
}) {
  const baixas = (opts.baixas ?? [{ usuarioId: null, conta: 'Asaas' }]).map((b, i) => ({
    id: `b${i}`,
    valor: 100,
    usuarioId: b.usuarioId,
    conta: { nome: b.conta },
  }));
  const prisma = {
    finTitulo: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 't-1', empresaId: 'emp-1', status: 'QUITADO', baixas }]),
      update: vi.fn((a: unknown) => a),
    },
    finBaixa: { updateMany: vi.fn((a: unknown) => a) },
    pedidoPagamento: {
      findMany: vi
        .fn()
        .mockResolvedValue((opts.pagamentos ?? ['pay_1']).map((id) => ({ asaasCobrancaId: id }))),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  };
  const integracoes = {
    obterCredenciaisInternas: vi
      .fn()
      .mockResolvedValue({ credenciais: { apiKey: '$aact_prod_x' } }),
  };
  const asaas = {
    cobrancaSeExistir: opts.erroAsaas
      ? vi.fn().mockRejectedValue(new Error('Asaas fora'))
      : vi.fn().mockResolvedValue(opts.cobranca ?? null),
  };
  class Svc extends FinanceiroAutomaticoService {
    protected override clienteAsaas() {
      return asaas as never;
    }
  }
  const svc = new Svc(
    prisma as never,
    {} as never,
    opts.semIntegracao ? undefined : (integracoes as never),
  );
  return { svc, prisma, asaas };
}

describe('cancelamento com recebimento × Asaas (07/11, opção b)', () => {
  it('cobrança não existe nesta conta (era sandbox): estorna sozinho', async () => {
    const { svc, prisma } = montar({ cobranca: null });
    expect(await svc.aoCancelarPedido('ped-1')).toEqual({ recebido: 0 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.finBaixa.updateMany).toHaveBeenCalledWith({
      where: { tituloId: 't-1', estornadaEm: null },
      data: { estornadaEm: expect.any(Date) },
    });
    expect(prisma.finTitulo.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { status: 'CANCELADO' },
    });
  });

  it.each(['REFUNDED', 'PENDING', 'OVERDUE'])('cobrança %s: estorna sozinho', async (status) => {
    const { svc, prisma } = montar({ cobranca: { id: 'pay_1', status } });
    expect(await svc.aoCancelarPedido('ped-1')).toEqual({ recebido: 0 });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('cobrança apagada: estorna sozinho', async () => {
    const { svc, prisma } = montar({
      cobranca: { id: 'pay_1', status: 'RECEIVED', deleted: true },
    });
    await svc.aoCancelarPedido('ped-1');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it.each([
    ['dinheiro na conta (RECEIVED)', { cobranca: { id: 'pay_1', status: 'RECEIVED' } }],
    [
      'situação desconhecida (CHARGEBACK_REQUESTED)',
      { cobranca: { id: 'p', status: 'CHARGEBACK_REQUESTED' } },
    ],
    ['baixa lançada por gente', { baixas: [{ usuarioId: 'u-1', conta: 'Asaas' }] }],
    [
      'baixa em outra conta (Pix manual no banco)',
      { baixas: [{ usuarioId: null, conta: 'Banco' }] },
    ],
    ['sem cobrança paga registrada', { pagamentos: [] }],
    ['Asaas fora do ar', { erroAsaas: true }],
    ['sem integração', { semIntegracao: true }],
  ])('%s: NÃO estorna, quem cancela decide', async (_n, opts) => {
    const { svc, prisma } = montar(opts as never);
    expect(await svc.aoCancelarPedido('ped-1')).toEqual({ recebido: 100 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.finTitulo.update).not.toHaveBeenCalled();
  });
});
