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

const build = (
  over: Record<string, unknown> = {},
  config: unknown = {},
  frontendUrl = 'https://app.somatecblocking.com.br',
) => {
  const prisma = {
    contrato: {
      findFirst: vi.fn().mockResolvedValue(fakeContrato(over)),
      update: vi.fn().mockResolvedValue({}),
    },
    empresa: { findUnique: vi.fn().mockResolvedValue({ config }) },
  };
  const tiny = {
    incluir: vi.fn().mockResolvedValue({ id: '338242389' }),
    alterar: vi.fn().mockResolvedValue(undefined),
    configurado: true,
  };
  const env = { get: vi.fn().mockReturnValue(frontendUrl) };
  const svc = new ContratoErpService(prisma as never, tiny as never, env as never);
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

  /**
   * ⚠️ A v2 do Tiny NÃO anexa arquivo em contrato — medido contra a API em
   * 12/09: rota de anexo não existe (404), e `contrato.alterar.php` aceita
   * `anexos` com status OK e ignora em silêncio. A observação é a única via
   * até o PDF, então ela não é enfeite: some o link, some o caminho.
   */
  it('a observação leva o caminho até o PDF assinado, já filtrado pela proposta', async () => {
    const { svc, tiny } = build();

    await svc.enviar('ctr-1', 'emp-1');

    expect(tiny.incluir).toHaveBeenCalledWith(
      expect.objectContaining({
        observacao: expect.stringContaining(
          'PDF assinado: https://app.somatecblocking.com.br/contratos?search=PROP-0007',
        ),
      }),
    );
  });

  it('sem FRONTEND_URL, a observação sai sem link — e não com um endereço quebrado', async () => {
    const { svc, tiny } = build({}, {}, '');

    await svc.enviar('ctr-1', 'emp-1');

    const obs = String((tiny.incluir.mock.calls[0][0] as { observacao: string }).observacao);
    expect(obs).toContain('proposta PROP-0007');
    expect(obs).not.toContain('PDF assinado');
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

/**
 * O contrato sobe assim que é assinado, e nesse momento a contabilidade em geral
 * ainda não definiu ISS, código de serviço e natureza. Ele entra Ativo, cobrando
 * e SEM emitir nota — foi o que aconteceu com o 340265142. Isto aqui é o que
 * liga a emissão depois, sem abrir contrato por contrato no painel.
 */
describe('ContratoErpService.sincronizarFiscal', () => {
  const FISCAL = {
    emiteNota: true,
    codigoListaServico: '14.01',
    naturezaOperacao: 'Locação de bens móveis',
    percentualIss: 2,
    servicoCodigo: 'LOC-MB',
    servicoNome: 'Locação MB',
  };

  beforeEach(() => vi.clearAllMocks());

  it('com os dados fiscais preenchidos, LIGA a emissão no contrato que já está no ERP', async () => {
    const { svc, tiny } = build(
      { contratoErpId: '338242389' },
      { erp: { contratoLocacao: FISCAL } },
    );

    await expect(svc.sincronizarFiscal('ctr-1', 'emp-1')).resolves.toEqual({ emiteNota: true });

    expect(tiny.alterar).toHaveBeenCalledWith(
      '338242389',
      expect.objectContaining({
        nota: expect.objectContaining({ codigoListaServico: '14.01', percentualIss: 2 }),
      }),
    );
  });

  /**
   * ⚠️ `contrato.alterar.php` é SUBSTITUIÇÃO: payload incompleto zera o resto
   * (medido em 05/09). O valor e o prazo têm que ir junto, mesmo sem mudar.
   */
  it('manda o contrato INTEIRO, não só o que mudou', async () => {
    const { svc, tiny } = build(
      { contratoErpId: '338242389' },
      { erp: { contratoLocacao: FISCAL } },
    );

    await svc.sincronizarFiscal('ctr-1', 'emp-1');

    expect(tiny.alterar).toHaveBeenCalledWith(
      '338242389',
      expect.objectContaining({
        valorMensal: expect.any(Number),
        prazoMeses: expect.any(Number),
        diaVencimento: expect.any(Number),
        cliente: expect.objectContaining({ nome: expect.any(String) }),
      }),
    );
  });

  it('pediu nota mas faltam dados: RECUSA — "sincronizei" com a emissão desligada é pior', async () => {
    const { svc, tiny } = build(
      { contratoErpId: '338242389' },
      { erp: { contratoLocacao: { emiteNota: true } } },
    );

    await expect(svc.sincronizarFiscal('ctr-1', 'emp-1')).rejects.toThrow(/dados fiscais/i);
    expect(tiny.alterar).not.toHaveBeenCalled();
  });

  it('contrato que nem está no ERP não tem o que sincronizar', async () => {
    const { svc, tiny } = build({ contratoErpId: null }, { erp: { contratoLocacao: FISCAL } });

    await expect(svc.sincronizarFiscal('ctr-1', 'emp-1')).rejects.toThrow(/não está no ERP/i);
    expect(tiny.alterar).not.toHaveBeenCalled();
  });
});
