import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComissaoRepVisaoService } from './comissao-rep-visao.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

const REP = { id: 'rep-1', role: 'REP', empresaIdAtiva: 'emp-1' } as AuthenticatedUser;

function build(opts: { fechada?: Record<string, unknown> | null; pedidos?: unknown[] } = {}) {
  const prisma = {
    comissao: {
      findFirst: vi.fn().mockResolvedValue(opts.fechada ?? null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    pedido: { findMany: vi.fn().mockResolvedValue(opts.pedidos ?? []) },
  };
  return { svc: new ComissaoRepVisaoService(prisma as never), prisma };
}

const PEDIDO = {
  id: 'ped-1',
  numero: 'PED-0001',
  total: 10000,
  valorDevolvido: 0,
  comissao: 600,
  comissaoEstornada: 0,
  enviadoErpEm: new Date('2026-07-10T12:00:00Z'),
  cliente: { nome: 'Indústria X' },
};

describe('comissão pelos olhos do rep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mês aberto: soma os pedidos e diz QUANDO cai (dia 05 do mês seguinte)', async () => {
    const { svc } = build({ pedidos: [PEDIDO, { ...PEDIDO, id: 'ped-2', comissao: 400 }] });

    const r = await svc.previsao(REP, 'emp-1', 7, 2026);

    expect(r.valor).toBe(1000);
    expect(r.qtdPedidos).toBe(2);
    expect(r.previsaoPagamentoEm).toBe('2026-08-05');
    expect(r.fechado).toBe(false);
    expect(r.pedidos[0]).toMatchObject({ numero: 'PED-0001', cliente: 'Indústria X' });
  });

  it('devolução aprovada sai da conta (o rep vê o líquido, não o bruto)', async () => {
    const { svc } = build({
      pedidos: [{ ...PEDIDO, valorDevolvido: 4000, comissaoEstornada: 240 }],
    });

    const r = await svc.previsao(REP, 'emp-1', 7, 2026);

    expect(r.valor).toBe(360);
    expect(r.base).toBe(6000);
  });

  it('mês FECHADO usa os números da folha, não recalcula', async () => {
    // A folha é snapshot da % vigente no fechamento. Recalcular mostraria outro
    // valor se a % do rep mudasse depois — e aí a tela discordaria do pagamento.
    const { svc } = build({
      fechada: { totalVendas: 9000, totalComissao: 540, qtdPedidos: 3 },
      pedidos: [PEDIDO],
    });

    const r = await svc.previsao(REP, 'emp-1', 7, 2026);

    expect(r.valor).toBe(540);
    expect(r.qtdPedidos).toBe(3);
    expect(r.fechado).toBe(true);
    // o detalhe continua vindo — é ele que explica o número
    expect(r.pedidos).toHaveLength(1);
  });

  it('dezembro cai em 05 de janeiro do ano seguinte', async () => {
    const { svc } = build({ pedidos: [PEDIDO] });

    const r = await svc.previsao(REP, 'emp-1', 12, 2026);

    expect(r.previsaoPagamentoEm).toBe('2027-01-05');
  });

  it('recebidas filtram pela data do PAGAMENTO e o "até" pega o dia inteiro', async () => {
    const { svc, prisma } = build();

    await svc.recebidas(REP, 'emp-1', '2026-07-01', '2026-07-31');

    const where = prisma.comissao.findMany.mock.calls[0][0].where;
    expect(where.pago).toBe(true);
    expect(where.pagoEm.lte.toISOString()).toBe('2026-07-31T23:59:59.999Z');
  });

  it('sem período, não filtra data (extrato inteiro)', async () => {
    const { svc, prisma } = build();

    await svc.recebidas(REP, 'emp-1');

    expect(prisma.comissao.findMany.mock.calls[0][0].where.pagoEm).toBeUndefined();
  });
});
