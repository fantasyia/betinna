import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContratoAprovacaoJob } from './contrato-aprovacao.job';

/**
 * O Tiny NÃO tem webhook de orçamento — os eventos dele são de pedido, nota e
 * estoque. Sem esta varredura o processo trava num passo invisível: o cliente
 * assinou, o Leandro aprovou no ERP, e a cobrança mensal nunca começa porque
 * ninguém contou pro app.
 */
const build = (situacao: string, pendentes = 1) => {
  const prisma = {
    contrato: {
      findMany: vi.fn().mockResolvedValue(
        Array.from({ length: pendentes }, (_, i) => ({
          id: `ctr-${i + 1}`,
          proposta: { numero: `PROP-000${i + 1}`, orcamentoErpId: `90${i + 1}` },
        })),
      ),
    },
  };
  const orcamentos = { obter: vi.fn().mockResolvedValue({ situacao }) };
  const erp = { enviar: vi.fn().mockResolvedValue({ contratoErpId: '338', jaExistia: false }) };
  const job = new ContratoAprovacaoJob(
    prisma as never,
    { get: () => 'production' } as never,
    { acquire: vi.fn().mockResolvedValue(true) } as never,
    orcamentos as never,
    erp as never,
  );
  return { job, prisma, orcamentos, erp };
};

describe('ContratoAprovacaoJob.varrer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('orçamento Aprovado → cria o contrato recorrente', async () => {
    const { job, erp } = build('Aprovado');

    await expect(job.varrer('emp-1')).resolves.toMatchObject({ verificados: 1, criados: 1 });
    expect(erp.enviar).toHaveBeenCalledWith('ctr-1', 'emp-1');
  });

  it('"Concluído" também conta como liberado', async () => {
    const { job, erp } = build('Concluído');

    await job.varrer('emp-1');

    expect(erp.enviar).toHaveBeenCalledOnce();
  });

  it('ainda "Em aberto": NÃO cria nada — a cobrança não pode começar antes do aval', async () => {
    const { job, erp } = build('Em aberto');

    await expect(job.varrer('emp-1')).resolves.toMatchObject({ criados: 0 });
    expect(erp.enviar).not.toHaveBeenCalled();
  });

  it('só olha contrato ASSINADO que ainda não subiu — o conjunto se esvazia sozinho', async () => {
    const { job, prisma } = build('Aprovado');

    await job.varrer('emp-1');

    expect(prisma.contrato.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          empresaId: 'emp-1',
          status: 'ASSINADO',
          contratoErpId: null,
        }),
      }),
    );
  });

  it('falha em um contrato não impede os outros — cada um é um cliente esperando', async () => {
    const { job, erp } = build('Aprovado', 3);
    erp.enviar
      .mockResolvedValueOnce({ contratoErpId: '1', jaExistia: false })
      .mockRejectedValueOnce(new Error('ERP fora do ar'))
      .mockResolvedValueOnce({ contratoErpId: '3', jaExistia: false });

    const r = await job.varrer('emp-1');

    expect(r.criados).toBe(2);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toContain('PROP-0002');
  });
});
