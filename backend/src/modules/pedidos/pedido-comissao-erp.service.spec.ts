import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PedidoComissaoErpService } from './pedido-comissao-erp.service';

function build(pedido: Record<string, unknown> | null) {
  const prisma = {
    pedido: { findFirst: vi.fn().mockResolvedValue(pedido) },
    pedidoComissao: { update: vi.fn().mockResolvedValue({}) },
  };
  let seq = 500;
  const contas = {
    criarContaPagar: vi.fn().mockImplementation(async () => ++seq),
    atualizarContaPagar: vi.fn().mockResolvedValue(undefined),
    marcarContaPagarCancelada: vi.fn().mockResolvedValue(undefined),
    acharCategoria: vi.fn().mockResolvedValue(335265865),
  };
  const svc = new PedidoComissaoErpService(prisma as never, contas as never);
  return { svc, prisma, contas };
}

const linha = (over: Record<string, unknown> = {}) => ({
  id: 'lin-1',
  tipo: 'SITE',
  percentual: 7.25,
  valor: new Prisma.Decimal('3.63'),
  contaPagarErpId: null,
  contaPagarValor: null,
  usuario: { nome: 'Marcelo Harada', contatoErpId: '894994139' },
  ...over,
});

const PEDIDO = {
  numero: 'PED-0002',
  numeroSite: 'SB104321',
  numeroErp: '42',
  enviadoErpEm: new Date('2026-09-05T12:00:00Z'),
  comissoesPedido: [linha()],
};

describe('conta a pagar de comissão POR PEDIDO', () => {
  beforeEach(() => vi.clearAllMocks());

  it('NF saiu → uma conta por beneficiário: Pix, única, vence dia 5 do mês seguinte, histórico com o pedido', async () => {
    const { svc, contas, prisma } = build(PEDIDO);

    const r = await svc.provisionar('emp-1', 'ped-2', { numero: 3, serie: 3 }, { criar: true });

    expect(r.criadas).toBe(1);
    const l = contas.criarContaPagar.mock.calls[0][1];
    expect(l).toMatchObject({
      idContato: 894994139,
      valor: 3.63,
      dataVencimento: '2026-10-05',
      dataCompetencia: '2026-09',
      numeroDocumento: 'COMISSAO SB104321',
      historico:
        'Comissão SITE 7.25% — Marcelo Harada · pedido SB104321 / PED-0002 / ERP 42 · NF 3 série 3',
      idCategoria: 335265865,
      formaPagamento: 15,
      ocorrencia: 'U',
    });
    expect(prisma.pedidoComissao.update.mock.calls[0][0].data).toEqual({
      contaPagarErpId: '501',
      contaPagarValor: 3.63,
    });
  });

  it('já tem conta e o valor não mudou → não toca no ERP', async () => {
    const { svc, contas } = build({
      ...PEDIDO,
      comissoesPedido: [linha({ contaPagarErpId: '501', contaPagarValor: 3.63 })],
    });

    const r = await svc.provisionar('emp-1', 'ped-2', null, { criar: true });

    expect(r).toMatchObject({ criadas: 0, atualizadas: 0 });
    expect(contas.criarContaPagar).not.toHaveBeenCalled();
    expect(contas.atualizarContaPagar).not.toHaveBeenCalled();
  });

  it('valor mudou (devolução) → reescreve a conta com o valor novo', async () => {
    const { svc, contas } = build({
      ...PEDIDO,
      comissoesPedido: [
        linha({ valor: new Prisma.Decimal('2.90'), contaPagarErpId: '501', contaPagarValor: 3.63 }),
      ],
    });

    const r = await svc.provisionar('emp-1', 'ped-2', null, { criar: false });

    expect(r.atualizadas).toBe(1);
    expect(contas.atualizarContaPagar.mock.calls[0][1]).toBe(501);
    expect(contas.atualizarContaPagar.mock.calls[0][2].valor).toBe(2.9);
  });

  it('zerou (cancelamento) com conta já criada → aviso pra apagar, não zera no ERP', async () => {
    const { svc, contas } = build({
      ...PEDIDO,
      comissoesPedido: [
        linha({ valor: new Prisma.Decimal('0'), contaPagarErpId: '501', contaPagarValor: 3.63 }),
      ],
    });

    const r = await svc.provisionar('emp-1', 'ped-2', null, { criar: false });

    expect(r.paraApagar).toEqual(['conta 501 (Marcelo Harada, SB104321 / PED-0002 / ERP 42)']);
    expect(contas.atualizarContaPagar).not.toHaveBeenCalled();
    expect(contas.marcarContaPagarCancelada).toHaveBeenCalledWith('emp-1', 501);
  });

  it('sem NF ainda (criar=false) → não cria conta nova', async () => {
    const { svc, contas } = build(PEDIDO);

    const r = await svc.provisionar('emp-1', 'ped-2', null, { criar: false });

    expect(r.criadas).toBe(0);
    expect(contas.criarContaPagar).not.toHaveBeenCalled();
  });

  it('beneficiário sem contato no ERP → fica na lista, não erra', async () => {
    const { svc, contas } = build({
      ...PEDIDO,
      comissoesPedido: [linha({ usuario: { nome: 'Fulano', contatoErpId: null } })],
    });

    const r = await svc.provisionar('emp-1', 'ped-2', null, { criar: true });

    expect(r.semContato).toEqual(['Fulano']);
    expect(contas.criarContaPagar).not.toHaveBeenCalled();
  });
});
