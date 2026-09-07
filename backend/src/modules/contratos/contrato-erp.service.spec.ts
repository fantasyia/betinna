import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ContratoErpService } from './contrato-erp.service';

/**
 * O contrato no ERP é o objeto que COBRA todo mês, e a API v2 do Tiny não tem
 * DELETE. Por isso as travas aqui são de porta: só sobe assinado, só sobe uma
 * vez, e só com o cadastro certo do cliente.
 */

const fakeContrato = (over: Record<string, unknown> = {}) => ({
  id: 'ctr-1',
  empresaId: 'emp-1',
  status: 'ASSINADO',
  valorMensal: new Prisma.Decimal('121.00'),
  prazoMeses: 12,
  diaVencimento: 5,
  primeiraCobrancaEm: new Date(Date.UTC(2026, 10, 1)),
  assinadoEm: new Date(Date.UTC(2026, 8, 1)),
  contratoErpId: null,
  cliente: { nome: 'Indústria X', cnpj: '12.345.678/0001-90' },
  proposta: { numero: 'PROP-0007' },
  ...over,
});

const build = (over: Record<string, unknown> = {}, config: unknown = {}) => {
  const prisma = {
    contrato: {
      findFirst: vi.fn().mockResolvedValue(fakeContrato(over)),
      update: vi.fn().mockResolvedValue({}),
    },
    empresa: { findUnique: vi.fn().mockResolvedValue({ config }) },
  };
  const tiny = { incluir: vi.fn().mockResolvedValue({ id: '338242389' }), configurado: true };
  const svc = new ContratoErpService(prisma as never, tiny as never);
  return { svc, prisma, tiny };
};

describe('ContratoErpService.enviar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sobe o contrato e guarda o id do ERP (e o contrato passa a ATIVO)', async () => {
    const { svc, prisma, tiny } = build();

    await expect(svc.enviar('ctr-1', 'emp-1')).resolves.toEqual({
      contratoErpId: '338242389',
      jaExistia: false,
    });

    expect(tiny.incluir).toHaveBeenCalledWith(
      expect.objectContaining({ valorMensal: 121, prazoMeses: 12, diaVencimento: 5 }),
    );
    expect(prisma.contrato.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contratoErpId: '338242389', status: 'ATIVO' }),
      }),
    );
  });

  it('o ciclo começa na PRIMEIRA COBRANÇA, não na assinatura — a carência já foi descontada', async () => {
    const { svc, tiny } = build();

    await svc.enviar('ctr-1', 'emp-1');

    expect(tiny.incluir.mock.calls[0][0].inicio).toEqual(new Date(Date.UTC(2026, 10, 1)));
  });

  it('já enviado NÃO sobe de novo — duas vezes é cobrança dupla no mesmo cliente', async () => {
    const { svc, tiny } = build({ contratoErpId: '111' });

    await expect(svc.enviar('ctr-1', 'emp-1')).resolves.toEqual({
      contratoErpId: '111',
      jaExistia: true,
    });
    expect(tiny.incluir).not.toHaveBeenCalled();
  });

  it('contrato NÃO assinado é barrado — no ERP ele vira cobrança e não dá pra excluir', async () => {
    const { svc, tiny } = build({ status: 'AGUARDANDO_ASSINATURA' });

    await expect(svc.enviar('ctr-1', 'emp-1')).rejects.toThrow(/não assinado/);
    expect(tiny.incluir).not.toHaveBeenCalled();
  });

  it('cliente sem CNPJ é barrado — o ERP amarraria o contrato a um contato NOVO', async () => {
    const { svc, tiny } = build({ cliente: { nome: 'Indústria X', cnpj: null } });

    await expect(svc.enviar('ctr-1', 'emp-1')).rejects.toThrow(/CNPJ/);
    expect(tiny.incluir).not.toHaveBeenCalled();
  });

  it('emitir nota sem os dados fiscais do tenant: sobe SEM nota, não inventa ISS', async () => {
    const { svc, tiny } = build({}, { erp: { contratoLocacao: { emiteNota: true } } });

    await svc.enviar('ctr-1', 'emp-1');

    expect(tiny.incluir.mock.calls[0][0].nota).toBeNull();
  });

  it('com os dados fiscais completos, a nota vai junto', async () => {
    const { svc, tiny } = build(
      {},
      {
        erp: {
          contratoLocacao: {
            emiteNota: true,
            codigoListaServico: '14.01',
            naturezaOperacao: 'Locação mensal de equipamento',
            percentualIss: 5,
            servicoCodigo: 'LOC-MB',
            servicoNome: 'Locação mensal Master Block IoT',
          },
        },
      },
    );

    await svc.enviar('ctr-1', 'emp-1');

    expect(tiny.incluir.mock.calls[0][0].nota).toMatchObject({ codigoListaServico: '14.01' });
  });

  it('o vencimento configurado pelo tenant chega no ERP', async () => {
    const { svc, tiny } = build({}, { erp: { contratoLocacao: { vencimento: 'C' } } });

    await svc.enviar('ctr-1', 'emp-1');

    expect(tiny.incluir.mock.calls[0][0].vencimento).toBe('C');
  });
});
