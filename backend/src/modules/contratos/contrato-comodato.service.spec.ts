import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContratoComodatoService } from './contrato-comodato.service';

const build = (
  over: {
    pedido?: Record<string, unknown> | null;
    proposta?: Record<string, unknown> | null;
    contrato?: Record<string, unknown> | null;
  } = {},
) => {
  const prisma = {
    pedido: {
      findFirst: vi.fn(async () =>
        over.pedido === undefined
          ? { numero: 'PED-0100', modalidade: 'LOCACAO', propostaNumero: 'PROP-0007' }
          : over.pedido,
      ),
    },
    proposta: {
      findFirst: vi.fn(async () =>
        over.proposta === undefined ? { id: 'prop-1' } : over.proposta,
      ),
    },
    contrato: {
      findUnique: vi.fn(async () =>
        over.contrato === undefined ? { id: 'ctr-1', primeiraCobrancaEm: null } : over.contrato,
      ),
      update: vi.fn(async () => ({})),
    },
  };
  const comissoes = { recalcular: vi.fn(async () => undefined) };
  const svc = new ContratoComodatoService(prisma as never, comissoes as never);
  return { svc, prisma, comissoes };
};

describe('ContratoComodatoService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('NF de comodato marca o início da cobrança e refaz o cronograma', async () => {
    // Sem isto `primeiraCobrancaEm` não era escrito por ninguém e as 36
    // competências saíam do `criadoEm` — do aceite da proposta, não da
    // instalação.
    const { svc, prisma, comissoes } = build();

    await svc.iniciarCobranca('emp-1', 'ped-1', { numero: 42, dataEmissao: '2026-10-20' });

    expect(prisma.contrato.update).toHaveBeenCalledWith({
      where: { id: 'ctr-1' },
      data: { primeiraCobrancaEm: new Date('2026-10-20T12:00:00.000Z') },
    });
    expect(comissoes.recalcular).toHaveBeenCalledWith('ctr-1');
  });

  it('pedido de VENDA não mexe em contrato nenhum', async () => {
    const { svc, prisma } = build({
      pedido: { numero: 'PED-0100', modalidade: 'VENDA', propostaNumero: 'PROP-0007' },
    });

    await svc.iniciarCobranca('emp-1', 'ped-1', { dataEmissao: '2026-10-20' });

    expect(prisma.contrato.update).not.toHaveBeenCalled();
  });

  it('contrato que já tem data não é remarcado — reemitir nota não empurra a 1ª competência', async () => {
    const { svc, prisma, comissoes } = build({
      contrato: { id: 'ctr-1', primeiraCobrancaEm: new Date('2026-09-01T12:00:00.000Z') },
    });

    await svc.iniciarCobranca('emp-1', 'ped-1', { dataEmissao: '2026-10-20' });

    expect(prisma.contrato.update).not.toHaveBeenCalled();
    expect(comissoes.recalcular).not.toHaveBeenCalled();
  });

  it('nota sem data de emissão: usa o momento em que o app viu a NF', async () => {
    const { svc, prisma } = build();

    await svc.iniciarCobranca('emp-1', 'ped-1', { numero: 42 });

    const arg = prisma.contrato.update.mock.calls[0]?.[0] as {
      data: { primeiraCobrancaEm: Date };
    };
    expect(arg.data.primeiraCobrancaEm).toBeInstanceOf(Date);
  });

  it('pedido de locação sem contrato correspondente não quebra o sync', async () => {
    const { svc, prisma } = build({ contrato: null });

    await expect(
      svc.iniciarCobranca('emp-1', 'ped-1', { dataEmissao: '2026-10-20' }),
    ).resolves.toBeUndefined();
    expect(prisma.contrato.update).not.toHaveBeenCalled();
  });
});
