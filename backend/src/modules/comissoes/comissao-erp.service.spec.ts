import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComissaoErpService } from './comissao-erp.service';

/**
 * A folha virando dinheiro no ERP.
 *
 * Aqui os testes são sobre DINHEIRO, então cobrem o que só apareceria no
 * fechamento contábil meses depois: competência no mês errado, vencimento fora
 * do dia 5, e — o pior — a mesma folha provisionada duas vezes.
 */
function build(
  opts: {
    comissoes?: Array<Record<string, unknown>>;
    originacao?: Record<string, unknown> | null;
    config?: Record<string, unknown> | null;
    pedidos?: Array<Record<string, unknown>>;
  } = {},
) {
  const prisma = {
    comissao: {
      findMany: vi.fn().mockResolvedValue(opts.comissoes ?? []),
      update: vi.fn().mockResolvedValue({}),
    },
    comissaoOriginacao: {
      findFirst: vi.fn().mockResolvedValue(opts.originacao ?? null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    empresa: {
      findUnique: vi.fn().mockResolvedValue({ config: opts.config ?? {} }),
    },
    pedido: { groupBy: vi.fn().mockResolvedValue(opts.pedidos ?? []) },
    usuario: { findUnique: vi.fn().mockResolvedValue({ contatoErpId: '999' }) },
  };
  const contas = {
    criarContaPagar: vi.fn().mockResolvedValue(4242),
    criarContaReceber: vi.fn().mockResolvedValue(4243),
    acharCategoria: vi.fn().mockResolvedValue(77),
  };
  const svc = new ComissaoErpService(prisma as never, contas as never);
  return { svc, prisma, contas };
}

const COMISSAO_REP = {
  id: 'com-1',
  tipo: 'REP',
  totalVendas: 100000,
  totalComissao: 5000,
  contaPagarErpId: null,
  representante: { id: 'rep-1', nome: 'Marcelo Harada', contatoErpId: '894881870' },
};

describe('folha de comissões no financeiro do ERP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vence dia 05 do mês SEGUINTE e tem competência no mês do faturamento', async () => {
    // As duas datas são coisas diferentes: competência é resultado, vencimento
    // é caixa. Trocar uma pela outra infla um mês e esvazia o outro.
    const { svc, contas } = build({ comissoes: [COMISSAO_REP] });

    await svc.provisionar('emp-1', 7, 2026);

    const lancamento = contas.criarContaPagar.mock.calls[0][1];
    expect(lancamento.dataVencimento).toBe('2026-08-05');
    expect(lancamento.dataCompetencia).toBe('2026-07');
    expect(lancamento.valor).toBe(5000);
    expect(lancamento.idContato).toBe(894881870);
  });

  it('dezembro vence em 05 de JANEIRO do ano seguinte', async () => {
    const { svc, contas } = build({ comissoes: [COMISSAO_REP] });

    await svc.provisionar('emp-1', 12, 2026);

    expect(contas.criarContaPagar.mock.calls[0][1].dataVencimento).toBe('2027-01-05');
  });

  it('comissão já provisionada NÃO é lançada de novo', async () => {
    // Re-rodar o fechamento não pode pagar ninguém duas vezes — e dinheiro
    // duplicado só aparece na conciliação, semanas depois.
    const { svc, contas } = build({
      comissoes: [{ ...COMISSAO_REP, contaPagarErpId: '999' }],
    });

    const r = await svc.provisionar('emp-1', 7, 2026);

    expect(contas.criarContaPagar).not.toHaveBeenCalled();
    expect(r.jaProvisionadas).toBe(1);
  });

  it('rep sem contato no ERP aparece pelo NOME em vez de sumir', async () => {
    const { svc, contas } = build({
      comissoes: [
        { ...COMISSAO_REP, representante: { ...COMISSAO_REP.representante, contatoErpId: null } },
      ],
    });

    const r = await svc.provisionar('emp-1', 7, 2026);

    expect(contas.criarContaPagar).not.toHaveBeenCalled();
    expect(r.semContatoNoErp).toEqual(['Marcelo Harada']);
  });

  it('guarda o id da conta criada (é o que torna idempotente)', async () => {
    const { svc, prisma } = build({ comissoes: [COMISSAO_REP] });

    await svc.provisionar('emp-1', 7, 2026);

    expect(prisma.comissao.update.mock.calls[0][0].data).toEqual({ contaPagarErpId: '4242' });
  });

  describe('comissão de originação', () => {
    const CONFIG = {
      comissaoOriginacao: { ativo: true, contatoErpId: '894891897', pctRep: 6, pctSemRep: 12 },
    };

    it('6% no que nasceu no APP (rep) e 12% no que veio de outra origem (site)', async () => {
      const { svc, contas } = build({
        comissoes: [COMISSAO_REP],
        config: CONFIG,
        pedidos: [
          { origem: 'REP_APP', _sum: { total: 10000, valorDevolvido: 0 } },
          { origem: 'ERP', _sum: { total: 5000, valorDevolvido: 0 } },
        ],
      });

      const r = await svc.provisionar('emp-1', 7, 2026);

      // 10.000 × 6% + 5.000 × 12% = 600 + 600
      expect(r.originacao.valor).toBe(1200);
      const originacao = contas.criarContaPagar.mock.calls.find((c) =>
        (c[1] as { numeroDocumento?: string }).numeroDocumento?.startsWith('ORIGINACAO'),
      );
      expect(originacao).toBeDefined();
      expect((originacao?.[1] as { valor: number }).valor).toBe(1200);
    });

    it('devolução aprovada sai da base (o líquido é o que vale)', async () => {
      const { svc } = build({
        comissoes: [COMISSAO_REP],
        config: CONFIG,
        pedidos: [{ origem: 'REP_APP', _sum: { total: 10000, valorDevolvido: 4000 } }],
      });

      const r = await svc.provisionar('emp-1', 7, 2026);

      expect(r.originacao.valor).toBe(360); // 6.000 × 6%
    });

    it('mês já provisionado não vira segunda conta', async () => {
      const { svc, contas } = build({
        comissoes: [],
        config: CONFIG,
        originacao: { id: 'o-1', contaPagarErpId: '111' },
        pedidos: [{ origem: 'REP_APP', _sum: { total: 10000, valorDevolvido: 0 } }],
      });

      const r = await svc.provisionar('emp-1', 7, 2026);

      expect(contas.criarContaPagar).not.toHaveBeenCalled();
      expect(r.originacao.motivo).toMatch(/já provisionada|nenhuma/i);
    });

    it('sem configuração, não inventa lançamento — e diz por quê', async () => {
      const { svc, contas } = build({ comissoes: [COMISSAO_REP], config: {} });

      const r = await svc.provisionar('emp-1', 7, 2026);

      expect(contas.criarContaPagar).toHaveBeenCalledTimes(1); // só a do rep
      expect(r.originacao.provisionada).toBe(false);
      expect(r.originacao.motivo).toMatch(/não configurada/i);
    });
  });
});
