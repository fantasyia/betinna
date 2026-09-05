import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PedidoFinanceiroErpService } from './pedido-financeiro-erp.service';

function build(pedido: Record<string, unknown> | null) {
  const prisma = {
    pedido: {
      findFirst: vi.fn().mockResolvedValue(pedido),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  let seq = 100;
  const contas = {
    criarContaReceber: vi.fn().mockImplementation(async () => ++seq),
    acharCategoria: vi.fn().mockResolvedValue(null),
  };
  const tiny = { lancarContasDaNota: vi.fn().mockRejectedValue(new Error('sem parcelas')) };
  const svc = new PedidoFinanceiroErpService(prisma as never, contas as never, tiny as never);
  return { svc, prisma, contas, tiny };
}

const PEDIDO = {
  numero: 'PED-0001',
  numeroSite: 'SB370658',
  numeroErp: '41',
  total: new Prisma.Decimal('60.11'),
  formaPagamento: 'PIX',
  condicaoPagamento: 'avista',
  contasReceberErp: null,
  cliente: { nome: 'Leandro', codigoErp: '894990459' },
};

describe('conta a receber no ERP quando o pedido fatura', () => {
  beforeEach(() => vi.clearAllMocks());

  it('site à vista: UMA conta, Pix, única, com NF e pedido no histórico', async () => {
    const { svc, contas, prisma } = build(PEDIDO);

    const r = await svc.lancarContasReceber('emp-1', 'ped-1', { numero: 2, serie: 3 });

    expect(r.efeito).toBe('lancado');
    expect(contas.criarContaReceber).toHaveBeenCalledTimes(1);
    const l = contas.criarContaReceber.mock.calls[0][1];
    expect(l).toMatchObject({
      idContato: 894990459,
      valor: 60.11,
      formaPagamento: 15,
      ocorrencia: 'U',
      numeroDocumento: 'SB370658',
      historico: 'NF 2 série 3 · pedido SB370658 / PED-0001 / ERP 41 · parcela 1/1',
    });
    // Vencimento à vista = hoje.
    expect(l.dataVencimento).toBe(l.dataCompetencia + l.dataVencimento.slice(7));
    expect(prisma.pedido.update.mock.calls[0][0].data.contasReceberErp).toEqual([
      { id: 101, parcela: 1, valor: 60.11, vencimento: l.dataVencimento },
    ]);
  });

  it('rep 30/60/90 boleto: três contas, centavo de sobra na última', async () => {
    const { svc, contas } = build({
      ...PEDIDO,
      total: new Prisma.Decimal('100.00'),
      formaPagamento: 'BOLETO',
      condicaoPagamento: '30_60_90',
    });

    const r = await svc.lancarContasReceber('emp-1', 'ped-1', null);

    expect(r.efeito).toBe('lancado');
    const valores = contas.criarContaReceber.mock.calls.map(
      (c: unknown[]) => (c[1] as { valor: number }).valor,
    );
    expect(valores).toEqual([33.33, 33.33, 33.34]);
    expect(contas.criarContaReceber.mock.calls[0][1].formaPagamento).toBe(5);
    expect(contas.criarContaReceber.mock.calls[2][1].historico).toMatch(/parcela 3\/3$/);
  });

  it('nota COM parcelas → o Tiny gera as contas; o app só registra a origem', async () => {
    const { svc, contas, tiny, prisma } = build(PEDIDO);
    tiny.lancarContasDaNota.mockResolvedValueOnce(undefined);

    const r = await svc.lancarContasReceber('emp-1', 'ped-1', { id: 77, numero: 3, serie: 3 });

    expect(r).toEqual({ efeito: 'lancadoPeloTiny', idNota: 77 });
    expect(tiny.lancarContasDaNota).toHaveBeenCalledWith('emp-1', 77);
    expect(contas.criarContaReceber).not.toHaveBeenCalled();
    expect(prisma.pedido.update.mock.calls[0][0].data.contasReceberErp).toEqual([
      { origem: 'tiny', idNota: 77 },
    ]);
  });

  it('já lançado → não lança de novo (a rodada diária passa todo dia)', async () => {
    const { svc, contas } = build({ ...PEDIDO, contasReceberErp: [{ id: 1 }] });

    const r = await svc.lancarContasReceber('emp-1', 'ped-1', null);

    expect(r.efeito).toBe('jaLancado');
    expect(contas.criarContaReceber).not.toHaveBeenCalled();
  });

  it('cliente sem contato no ERP → não lança, avisa', async () => {
    const { svc, contas } = build({ ...PEDIDO, cliente: { nome: 'X', codigoErp: null } });

    const r = await svc.lancarContasReceber('emp-1', 'ped-1', null);

    expect(r.efeito).toBe('semContato');
    expect(contas.criarContaReceber).not.toHaveBeenCalled();
  });
});
