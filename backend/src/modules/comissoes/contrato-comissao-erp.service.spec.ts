import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContratoComissaoErpService } from './contrato-comissao-erp.service';

const linha = (over: Record<string, unknown> = {}) => ({
  id: 'cc-1',
  tipo: 'REP',
  percentual: 10,
  valor: 12.1,
  competencia: new Date('2026-10-01T00:00:00.000Z'),
  usuario: { nome: 'Harada', contatoErpId: '894990459' },
  contrato: {
    status: 'ATIVO',
    cliente: { nome: 'Indústria Alfa' },
    proposta: { numero: 'PROP-0007' },
  },
  ...over,
});

const build = (linhas: Array<Record<string, unknown>> = [linha()]) => {
  const prisma = {
    contrato: { findFirst: vi.fn(async () => ({ id: 'ctr-1' })) },
    contratoComissao: {
      findMany: vi.fn(async () => linhas),
      update: vi.fn(async () => ({})),
    },
  };
  const contas = {
    acharCategoria: vi.fn(async () => 338186079),
    criarContaPagar: vi.fn(async () => 338205280),
  };
  const comissoes = { registrarMensalidadeRecebida: vi.fn(async () => 1) };
  const svc = new ContratoComissaoErpService(prisma as never, contas as never, comissoes as never);
  return { svc, prisma, contas, comissoes };
};

describe('ContratoComissaoErpService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('só olha mês com mensalidade recebida e ainda sem conta no ERP', async () => {
    // Sem este filtro a comissão de locação viraria conta a pagar antes de o
    // cliente pagar a mensalidade — que é exatamente o erro que a locação por
    // mês existe pra evitar.
    const { svc, prisma } = build();

    await svc.provisionar('emp-1');

    const w = prisma.contratoComissao.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(w.where).toMatchObject({
      empresaId: 'emp-1',
      mensalidadeRecebidaEm: { not: null },
      contaPagarErpId: null,
      valor: { gt: 0 },
    });
  });

  it('cria a conta a pagar em Pix, ocorrência ÚNICA, vencendo dia 05 do mês seguinte', async () => {
    // Recorrente no ERP é só a mensalidade que o CLIENTE paga; a comissão de
    // cada mês é lançamento próprio, senão o financeiro não sabe qual mês pagou.
    const { svc, contas, prisma } = build();

    const r = await svc.provisionar('emp-1');

    expect(r.criadas).toBe(1);
    const lanc = contas.criarContaPagar.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(lanc).toMatchObject({
      idContato: 894990459,
      valor: 12.1,
      dataVencimento: '2026-11-05',
      dataCompetencia: '2026-10',
      formaPagamento: 15,
      ocorrencia: 'U',
      idCategoria: 338186079,
    });
    expect(lanc.historico).toContain('mensalidade 2026-10');
    expect(lanc.historico).toContain('PROP-0007');
    expect(prisma.contratoComissao.update).toHaveBeenCalledWith({
      where: { id: 'cc-1' },
      data: { contaPagarErpId: '338205280', contaPagarValor: 12.1 },
    });
  });

  it('rep sem contato no ERP: não inventa conta, devolve o nome', async () => {
    const { svc, contas } = build([linha({ usuario: { nome: 'Harada', contatoErpId: null } })]);

    const r = await svc.provisionar('emp-1');

    expect(contas.criarContaPagar).not.toHaveBeenCalled();
    expect(r.semContato).toEqual(['Harada']);
    expect(r.criadas).toBe(0);
  });

  it('contrato cancelado não ganha conta nova', async () => {
    const { svc, contas } = build([
      linha({
        contrato: { status: 'CANCELADO', cliente: null, proposta: { numero: 'PROP-0007' } },
      }),
    ]);

    const r = await svc.provisionar('emp-1');

    expect(contas.criarContaPagar).not.toHaveBeenCalled();
    expect(r.criadas).toBe(0);
  });

  it('erro do Tiny numa linha não derruba as outras', async () => {
    const { svc, contas } = build([linha(), linha({ id: 'cc-2' })]);
    contas.criarContaPagar.mockRejectedValueOnce(new Error('429'));

    const r = await svc.provisionar('emp-1');

    expect(r.erros).toBe(1);
    expect(r.criadas).toBe(1);
  });

  describe('mensalidadeRecebida — o gatilho', () => {
    it('marca o mês e já provisiona, sem esperar a rodada da madrugada', async () => {
      const { svc, comissoes, contas } = build();

      const r = await svc.mensalidadeRecebida(
        'emp-1',
        'ctr-1',
        new Date('2026-10-01T00:00:00.000Z'),
      );

      expect(comissoes.registrarMensalidadeRecebida).toHaveBeenCalledWith(
        'ctr-1',
        new Date('2026-10-01T00:00:00.000Z'),
        undefined,
      );
      expect(contas.criarContaPagar).toHaveBeenCalled();
      expect(r.liberadas).toBe(1);
      expect(r.criadas).toBe(1);
    });

    it('contrato de outra empresa: 404, e não marca nada', async () => {
      // O id vem do corpo da requisição — sem esta checagem, um tenant
      // registraria recebimento no contrato do outro.
      const { svc, prisma, comissoes } = build();
      prisma.contrato.findFirst.mockResolvedValue(null);

      await expect(
        svc.mensalidadeRecebida('emp-1', 'ctr-de-outro', new Date('2026-10-01T00:00:00.000Z')),
      ).rejects.toThrow('Contrato não encontrado');
      expect(comissoes.registrarMensalidadeRecebida).not.toHaveBeenCalled();
    });
  });
});
