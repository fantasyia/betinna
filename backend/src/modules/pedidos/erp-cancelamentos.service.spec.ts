import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErpCancelamentosService } from './erp-cancelamentos.service';

function build(
  opts: {
    cancelados?: Array<Record<string, unknown>>;
    erp?: Record<string, unknown>;
    nota?: Record<string, unknown>;
    folha?: Array<Record<string, unknown>>;
    folhaDepois?: Array<Record<string, unknown>>;
  } = {},
) {
  const prisma = {
    pedido: { findMany: vi.fn().mockResolvedValue(opts.cancelados ?? []) },
    comissao: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce(opts.folha ?? [])
        .mockResolvedValue(opts.folhaDepois ?? []),
    },
  };
  const tiny = {
    listar: vi.fn().mockResolvedValue({ itens: [{ id: 900, numeroPedido: 41 }], total: 1 }),
    obter: vi.fn().mockResolvedValue({ id: 900, situacao: 0, ...(opts.erp ?? {}) }),
    obterNota: vi
      .fn()
      .mockResolvedValue({ id: 77, numero: 12, serie: '3', situacao: 6, ...(opts.nota ?? {}) }),
    cancelar: vi.fn().mockResolvedValue(undefined),
    estornarContasDaNota: vi.fn().mockResolvedValue(undefined),
    estornarContasDoPedido: vi.fn().mockResolvedValue(undefined),
  };
  const contas = {
    marcarContaReceberCancelada: vi.fn().mockResolvedValue(undefined),
    contaReceberExiste: vi.fn().mockResolvedValue(true),
  };
  const comissoesPedido = { recalcular: vi.fn().mockResolvedValue(undefined) };
  const comissoes = { fecharMes: vi.fn().mockResolvedValue({ ok: true }) };
  const notificacoes = { criarParaRole: vi.fn().mockResolvedValue(1) };
  const comissaoErp = {
    provisionar: vi
      .fn()
      .mockResolvedValue({ criadas: 0, atualizadas: 0, semContato: [], paraApagar: [], erros: 0 }),
  };
  const svc = new ErpCancelamentosService(
    prisma as never,
    tiny as never,
    comissoesPedido as never,
    comissoes as never,
    notificacoes as never,
    comissaoErp as never,
    contas as never,
  );
  return { svc, prisma, tiny, comissoesPedido, comissoes, notificacoes, contas };
}

const CANCELADO = {
  id: 'ped-1',
  numero: 'PED-0001',
  numeroSite: 'SB370658',
  numeroErp: '41',
  enviadoErpEm: new Date('2026-09-04T21:00:00Z'),
  observacoes: null,
};

describe('varredura diária de cancelamentos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancelado aqui e ABERTO no ERP → cancela lá e some com a linha de comissão', async () => {
    const { svc, tiny, comissoesPedido } = build({ cancelados: [CANCELADO], erp: { situacao: 3 } });

    const r = await svc.varrer('emp-1');

    expect(tiny.cancelar).toHaveBeenCalledWith('emp-1', 900);
    expect(comissoesPedido.recalcular).toHaveBeenCalledWith('ped-1');
    expect(r.canceladosNoErp).toBe(1);
    expect(r.notasParaEstornar).toEqual([]);
  });

  it('já cancelado nos dois lados → não mexe no ERP', async () => {
    const { svc, tiny } = build({ cancelados: [CANCELADO], erp: { situacao: 2 } });

    const r = await svc.varrer('emp-1');

    expect(tiny.cancelar).not.toHaveBeenCalled();
    expect(r.conferidos).toBe(1);
    expect(r.canceladosNoErp).toBe(0);
  });

  it('nota fiscal AUTORIZADA no pedido cancelado → avisa o diretor, não cancela nota', async () => {
    // Cancelar nota é ato fiscal: aqui só se garante que alguém fica sabendo.
    const { svc, tiny, notificacoes } = build({
      cancelados: [CANCELADO],
      erp: { situacao: 2, idNotaFiscal: 77 },
      nota: { situacao: 6 },
    });

    const r = await svc.varrer('emp-1');

    expect(tiny.obterNota).toHaveBeenCalledWith('emp-1', 77);
    expect(r.notasParaEstornar).toEqual(['NF 12 série 3 do pedido SB370658 / PED-0001 / ERP 41']);
    expect(notificacoes.criarParaRole).toHaveBeenCalledTimes(1);
    expect(notificacoes.criarParaRole.mock.calls[0][0]).toMatchObject({
      roles: ['DIRECTOR', 'ADMIN'],
      tipo: 'GENERICO',
      prioridade: 'ALTA',
    });
  });

  it('nota já cancelada no ERP → nada a estornar', async () => {
    const { svc, notificacoes } = build({
      cancelados: [CANCELADO],
      erp: { situacao: 2, idNotaFiscal: 77 },
      nota: { situacao: 3 },
    });

    const r = await svc.varrer('emp-1');

    expect(r.notasParaEstornar).toEqual([]);
    expect(notificacoes.criarParaRole).not.toHaveBeenCalled();
  });

  it('mês da folha já FECHADO → reprocessa (a conta no ERP acompanha)', async () => {
    const { svc, comissoes } = build({
      cancelados: [CANCELADO],
      erp: { situacao: 2 },
      folha: [{ id: 'c1', pago: false, totalComissao: 3.63, contaPagarErpId: '338181693' }],
    });

    const r = await svc.varrer('emp-1');

    expect(comissoes.fecharMes).toHaveBeenCalledTimes(1);
    expect(comissoes.fecharMes.mock.calls[0][1]).toEqual({ mes: 9, ano: 2026, reprocessar: true });
    expect(r.mesesReprocessados).toEqual(['09/2026']);
  });

  it('comissão que ZEROU mas já tinha conta no ERP → aviso pra apagar lá', async () => {
    const { svc } = build({
      cancelados: [CANCELADO],
      erp: { situacao: 2 },
      folha: [{ id: 'c1', pago: false, totalComissao: 3.63, contaPagarErpId: '338181693' }],
      folhaDepois: [{ contaPagarErpId: '338181693', representante: { nome: 'Marcelo Harada' } }],
    });

    const r = await svc.varrer('emp-1');

    expect(r.avisos).toEqual([
      'conta a pagar 338181693 (Marcelo Harada, 09/2026) ficou sem valor — apagar no ERP',
    ]);
  });

  it('folha já PAGA → não reprocessa, avisa', async () => {
    const { svc, comissoes } = build({
      cancelados: [CANCELADO],
      erp: { situacao: 2 },
      folha: [{ id: 'c1', pago: true, totalComissao: 3.63, contaPagarErpId: '1' }],
    });

    const r = await svc.varrer('emp-1');

    expect(comissoes.fecharMes).not.toHaveBeenCalled();
    expect(r.avisos).toEqual(['folha 09/2026 já está PAGA — cancelamento exige acerto manual']);
  });

  it('mês ainda ABERTO (sem folha) → não reprocessa nada', async () => {
    const { svc, comissoes } = build({ cancelados: [CANCELADO], erp: { situacao: 2 } });

    const r = await svc.varrer('emp-1');

    expect(comissoes.fecharMes).not.toHaveBeenCalled();
    expect(r.mesesReprocessados).toEqual([]);
  });

  it('NF ainda AUTORIZADA → não tenta estornar a conta a receber, manda cancelar a nota', async () => {
    // Com a nota de pé o Tiny recusa o estorno; quem baixa a conta é o
    // cancelamento da NF com "estornar contas".
    const { svc, tiny, contas } = build({
      cancelados: [
        { ...CANCELADO, contasReceberErp: [{ origem: 'tiny', idNota: 77, ids: [900] }] },
      ],
      erp: { situacao: 2, idNotaFiscal: 77 },
      nota: { situacao: 6 },
    });

    const r = await svc.varrer('emp-1');

    expect(tiny.estornarContasDaNota).not.toHaveBeenCalled();
    expect(tiny.estornarContasDoPedido).not.toHaveBeenCalled();
    expect(contas.marcarContaReceberCancelada).not.toHaveBeenCalled();
    expect(r.avisos.some((a) => a.includes('cancele a NF marcando'))).toBe(true);
  });

  it('NF cancelada COM "estornar contas": a conta some e a varredura só confirma', async () => {
    const { svc, contas } = build({
      cancelados: [
        { ...CANCELADO, contasReceberErp: [{ origem: 'tiny', idNota: 77, ids: [900] }] },
      ],
      erp: { situacao: 2, idNotaFiscal: 77 },
      nota: { situacao: 3 },
    });
    contas.contaReceberExiste.mockResolvedValue(false);

    const r = await svc.varrer('emp-1');

    expect(contas.marcarContaReceberCancelada).not.toHaveBeenCalled();
    expect(r.avisos).toContain('PED-0001: conta(s) a receber baixada(s) pelo cancelamento da NF');
  });

  it('NF já cancelada → estorna a conta a receber (nota, senão venda) e marca CANCELADA', async () => {
    const { svc, tiny, contas } = build({
      cancelados: [
        { ...CANCELADO, contasReceberErp: [{ origem: 'tiny', idNota: 77, ids: [900] }] },
      ],
      erp: { situacao: 2, idNotaFiscal: 77 },
      nota: { situacao: 3 },
    });
    tiny.estornarContasDaNota.mockRejectedValueOnce(new Error('Conta foi lançada pela venda'));

    const r = await svc.varrer('emp-1');

    expect(tiny.estornarContasDoPedido).toHaveBeenCalledWith('emp-1', 900);
    expect(contas.marcarContaReceberCancelada).toHaveBeenCalledWith('emp-1', 900);
    expect(r.avisos.some((a) => a.includes('marcada(s) CANCELADA'))).toBe(true);
  });

  it('ERP fora do ar num pedido não derruba a passada', async () => {
    const { svc, tiny, comissoesPedido } = build({ cancelados: [CANCELADO] });
    tiny.listar.mockRejectedValueOnce(new Error('ERP fora'));

    const r = await svc.varrer('emp-1');

    expect(r.erros).toBe(1);
    // A comissão do pedido cancelado é recalculada mesmo assim.
    expect(comissoesPedido.recalcular).toHaveBeenCalledWith('ped-1');
  });
});
