import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComissaoBaixaSyncService } from './comissao-baixa-sync.service';

/**
 * "Paga" na tela do rep = conta BAIXADA no ERP. O pagamento acontece lá; o app
 * lê. Sem esta varredura, comissão paga ficava eternamente em "a pagar em
 * 05/MM" — e quem já recebeu via o mesmo que quem não recebeu.
 */
const makePrisma = () => ({
  pedidoComissao: {
    findMany: vi.fn(async () => [] as unknown[]),
    update: vi.fn(async () => ({})),
  },
  contratoComissao: {
    findMany: vi.fn(async () => [] as unknown[]),
    update: vi.fn(async () => ({})),
  },
});

describe('ComissaoBaixaSyncService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let contas: { obterContaPagar: ReturnType<typeof vi.fn> };
  let svc: ComissaoBaixaSyncService;

  beforeEach(() => {
    prisma = makePrisma();
    contas = { obterContaPagar: vi.fn() };
    svc = new ComissaoBaixaSyncService(prisma as never, contas as never);
  });

  it('conta paga vira pagoEm com a DATA DA LIQUIDAÇÃO (não a de hoje)', async () => {
    prisma.pedidoComissao.findMany.mockResolvedValue([{ id: 'pc-1', contaPagarErpId: '900' }]);
    contas.obterContaPagar.mockResolvedValue({
      id: 900,
      situacao: 'pago',
      dataLiquidacao: '2026-10-05',
    });

    const r = await svc.varrer('emp-1');

    expect(r).toEqual({ conferidas: 1, baixadas: 1, erros: 0 });
    const arg = prisma.pedidoComissao.update.mock.calls[0][0] as {
      where: { id: string };
      data: { pagoEm: Date };
    };
    expect(arg.where.id).toBe('pc-1');
    expect(arg.data.pagoEm.toISOString().slice(0, 10)).toBe('2026-10-05');
  });

  it('PARCIAL não é pago — o resto do dinheiro do rep não pode sumir da tela', async () => {
    prisma.pedidoComissao.findMany.mockResolvedValue([{ id: 'pc-1', contaPagarErpId: '900' }]);
    contas.obterContaPagar.mockResolvedValue({ id: 900, situacao: 'parcial' });

    const r = await svc.varrer('emp-1');

    expect(r.baixadas).toBe(0);
    expect(prisma.pedidoComissao.update).not.toHaveBeenCalled();
  });

  it('conta ainda aberta: não mexe', async () => {
    prisma.pedidoComissao.findMany.mockResolvedValue([{ id: 'pc-1', contaPagarErpId: '900' }]);
    contas.obterContaPagar.mockResolvedValue({ id: 900, situacao: 'aberto' });

    expect((await svc.varrer('emp-1')).baixadas).toBe(0);
  });

  it('locação (ContratoComissao) segue a mesma regra', async () => {
    prisma.contratoComissao.findMany.mockResolvedValue([{ id: 'cc-1', contaPagarErpId: '901' }]);
    contas.obterContaPagar.mockResolvedValue({ id: 901, situacao: 'pago' });

    const r = await svc.varrer('emp-1');

    expect(r.baixadas).toBe(1);
    expect(prisma.contratoComissao.update).toHaveBeenCalled();
  });

  it('erro numa conta não interrompe as outras', async () => {
    prisma.pedidoComissao.findMany.mockResolvedValue([
      { id: 'pc-1', contaPagarErpId: '900' },
      { id: 'pc-2', contaPagarErpId: '901' },
    ]);
    contas.obterContaPagar
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ id: 901, situacao: 'pago' });

    const r = await svc.varrer('emp-1');

    expect(r).toEqual({ conferidas: 2, baixadas: 1, erros: 1 });
  });

  it('só consulta o que tem conta e ainda não foi pago (linha paga nunca mais é lida)', async () => {
    await svc.varrer('emp-1');

    const w = prisma.pedidoComissao.findMany.mock.calls[0][0] as {
      where: { contaPagarErpId: { not: null }; pagoEm: null };
    };
    expect(w.where.pagoEm).toBeNull();
    expect(w.where.contaPagarErpId).toEqual({ not: null });
  });
});
