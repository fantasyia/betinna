import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ContratoComissoesService, competencias, mesUtc } from './contrato-comissoes.service';

const makePrisma = () => ({
  contrato: { findUnique: vi.fn() },
  usuario: { findUnique: vi.fn(async () => ({ comissaoPadrao: 10 })) },
  contratoComissao: {
    findUnique: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
});

describe('ContratoComissoesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: ContratoComissoesService;

  const contrato = (over: Record<string, unknown> = {}) => ({
    id: 'ctr-1',
    empresaId: 'emp-1',
    status: 'ATIVO',
    valorMensal: new Prisma.Decimal('121.00'),
    prazoMeses: 36,
    primeiraCobrancaEm: new Date('2026-10-15T00:00:00.000Z'),
    criadoEm: new Date('2026-09-05T00:00:00.000Z'),
    representanteId: 'rep-1',
    ...over,
  });

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ContratoComissoesService(prisma as never);
  });

  it('gera UMA linha por mês do contrato — locação paga todo mês, não uma vez', async () => {
    prisma.contrato.findUnique.mockResolvedValue(contrato());

    await svc.recalcular('ctr-1');

    expect(prisma.contratoComissao.create).toHaveBeenCalledTimes(36);
  });

  it('a comissão do mês é sobre a MENSALIDADE, não sobre o contrato inteiro', async () => {
    // 121,00 × 10% = 12,10 por mês. O erro que isto previne: pagar 10% sobre
    // 121 × 36 = 435,60 de uma vez, na instalação.
    prisma.contrato.findUnique.mockResolvedValue(contrato());

    await svc.recalcular('ctr-1');

    const primeira = prisma.contratoComissao.create.mock.calls[0][0] as {
      data: { base: Prisma.Decimal; valor: Prisma.Decimal; percentual: number };
    };
    expect(Number(primeira.data.base)).toBe(121);
    expect(Number(primeira.data.valor)).toBe(12.1);
    expect(primeira.data.percentual).toBe(10);
  });

  it('a 1ª competência é a PRIMEIRA COBRANÇA, não a assinatura (carência não paga)', async () => {
    prisma.contrato.findUnique.mockResolvedValue(contrato());

    await svc.recalcular('ctr-1');

    const primeira = prisma.contratoComissao.create.mock.calls[0][0] as {
      data: { competencia: Date };
    };
    expect(primeira.data.competencia.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('contrato cancelado não gera nada e limpa o que havia', async () => {
    prisma.contrato.findUnique.mockResolvedValue(contrato({ status: 'CANCELADO' }));

    await svc.recalcular('ctr-1');

    expect(prisma.contratoComissao.create).not.toHaveBeenCalled();
    expect(prisma.contratoComissao.deleteMany).toHaveBeenCalledWith({
      where: { contratoId: 'ctr-1', contaPagarErpId: null },
    });
  });

  it('rep sem % configurada: nenhuma linha (não inventa comissão)', async () => {
    prisma.contrato.findUnique.mockResolvedValue(contrato());
    prisma.usuario.findUnique.mockResolvedValue({ comissaoPadrao: 0 });

    await svc.recalcular('ctr-1');

    expect(prisma.contratoComissao.create).not.toHaveBeenCalled();
  });

  it('recálculo NÃO reescreve mês que já virou conta no ERP', async () => {
    // O valor que está no ERP é o que o financeiro viu. Um recálculo (mudou a %
    // do rep, por exemplo) pode corrigir o que ainda é promessa, nunca o que já
    // virou conta a pagar — senão a tela e o ERP passam a discordar.
    prisma.contrato.findUnique.mockResolvedValue(contrato({ prazoMeses: 1 }));
    prisma.contratoComissao.findUnique.mockResolvedValue({
      id: 'cc-1',
      contaPagarErpId: '338205280',
    });

    await svc.recalcular('ctr-1');

    expect(prisma.contratoComissao.create).not.toHaveBeenCalled();
    expect(prisma.contratoComissao.update).not.toHaveBeenCalled();
  });

  it('recálculo reescreve mês que ainda não virou conta', async () => {
    prisma.contrato.findUnique.mockResolvedValue(contrato({ prazoMeses: 1 }));
    prisma.contratoComissao.findUnique.mockResolvedValue({ id: 'cc-1', contaPagarErpId: null });

    await svc.recalcular('ctr-1');

    expect(prisma.contratoComissao.create).not.toHaveBeenCalled();
    expect(prisma.contratoComissao.update).toHaveBeenCalledWith({
      where: { id: 'cc-1' },
      data: expect.objectContaining({ percentual: 10 }),
    });
  });

  it('encerrado: apaga os meses FUTUROS sem conta, preserva os que já viraram dinheiro', async () => {
    prisma.contrato.findUnique.mockResolvedValue(contrato({ status: 'ENCERRADO' }));

    await svc.recalcular('ctr-1');

    const del = prisma.contratoComissao.deleteMany.mock.calls.at(-1)?.[0] as {
      where: { contaPagarErpId: null; competencia: { gt: Date } };
    };
    expect(del.where.contaPagarErpId).toBeNull();
    expect(del.where.competencia.gt).toBeInstanceOf(Date);
  });

  it('falha no banco não derruba quem chamou (best-effort, igual à venda)', async () => {
    prisma.contrato.findUnique.mockRejectedValue(new Error('banco fora'));
    await expect(svc.recalcular('ctr-1')).resolves.toBeUndefined();
  });

  describe('registrarMensalidadeRecebida — o gatilho da locação', () => {
    it('marca só o mês da competência, e só o que ainda não tinha data', async () => {
      prisma.contratoComissao.updateMany.mockResolvedValue({ count: 1 });

      const n = await svc.registrarMensalidadeRecebida(
        'ctr-1',
        new Date('2026-11-20T12:00:00.000Z'),
        new Date('2026-11-20T12:00:00.000Z'),
      );

      expect(n).toBe(1);
      const w = prisma.contratoComissao.updateMany.mock.calls[0][0] as {
        where: { competencia: Date; mensalidadeRecebidaEm: null };
      };
      expect(w.where.competencia.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(w.where.mensalidadeRecebidaEm).toBeNull();
    });
  });
});

describe('helpers de competência', () => {
  it('mesUtc normaliza pro dia 1', () => {
    expect(mesUtc(new Date('2026-10-31T23:59:00.000Z')).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('competencias atravessa a virada de ano', () => {
    const m = competencias(new Date(Date.UTC(2026, 10, 1)), 3).map((d) =>
      d.toISOString().slice(0, 7),
    );
    expect(m).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});
