import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ContratoMensalidadeSyncService } from './contrato-mensalidade-sync.service';

const COMPETENCIA = new Date(Date.UTC(2026, 8, 1)); // 2026-09

/** Cobrança de contrato como o Tiny devolve de verdade (medido em 05/09). */
const cobranca = (over: Record<string, unknown> = {}) => ({
  id: 338302485,
  situacao: 'pago',
  dataVencimento: '2026-10-05',
  historico: 'Referente à cobrança de contrato 09/2026 e RPS nº 000000001',
  valor: 121,
  numeroDocumento: '000000001',
  serieDocumento: 'D',
  cliente: { id: 894990459, nome: 'Leandro de Albuquerque Pereira Lima' },
  ...over,
});

const contrato = (over: Record<string, unknown> = {}) => ({
  id: 'ctr-1',
  valorMensal: new Prisma.Decimal('121.00'),
  cliente: { codigoErp: '894990459', nome: 'Leandro' },
  comissoes: [{ competencia: COMPETENCIA }],
  ...over,
});

const build = (contratos: unknown[] = [contrato()], cobrancas: unknown[] = [cobranca()]) => {
  const prisma = { contrato: { findMany: vi.fn(async () => contratos) } };
  const contas = {
    listarContasReceber: vi.fn(async () => cobrancas),
    obterContaReceber: vi.fn(async () => ({ situacao: 'pago', dataLiquidacao: '2026-10-03' })),
  };
  const erpLocacao = {
    mensalidadeRecebida: vi.fn(async () => ({
      liberadas: 1,
      criadas: 1,
      semContato: [],
      erros: 0,
    })),
  };
  const svc = new ContratoMensalidadeSyncService(
    prisma as never,
    contas as never,
    erpLocacao as never,
  );
  return { svc, prisma, contas, erpLocacao };
};

describe('ContratoMensalidadeSyncService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cobrança paga do contrato libera a mensalidade daquele mês', async () => {
    const { svc, erpLocacao } = build();

    const r = await svc.varrer('emp-1');

    expect(erpLocacao.mensalidadeRecebida).toHaveBeenCalledWith(
      'emp-1',
      'ctr-1',
      COMPETENCIA,
      // data em que o dinheiro entrou, não a de hoje
      new Date('2026-10-03T12:00:00.000Z'),
    );
    expect(r.mensalidadesRegistradas).toBe(1);
    expect(r.comissoesProvisionadas).toBe(1);
  });

  it('pede ao ERP só o que está PAGO — vencido não é recebido', async () => {
    const { svc, contas } = build();

    await svc.varrer('emp-1');

    expect(contas.listarContasReceber).toHaveBeenCalledWith(
      'emp-1',
      expect.objectContaining({ situacao: 'pago' }),
    );
  });

  it('ignora conta que veio da NOTA, não do contrato (série diferente)', async () => {
    // As contas da NF vêm com a série da nota e histórico "Ref. a NF nº 9" —
    // se entrassem aqui, a venda liberaria comissão de locação.
    const { svc, erpLocacao } = build(
      [contrato()],
      [cobranca({ serieDocumento: '3', historico: 'Ref. a NF nº 9, Leandro' })],
    );

    const r = await svc.varrer('emp-1');

    expect(erpLocacao.mensalidadeRecebida).not.toHaveBeenCalled();
    expect(r.cobrancasPagas).toBe(0);
  });

  it('cobrança de outro cliente não mexe no contrato', async () => {
    const { svc, erpLocacao } = build(
      [contrato()],
      [cobranca({ cliente: { id: 999, nome: 'Outra empresa' } })],
    );

    await svc.varrer('emp-1');

    expect(erpLocacao.mensalidadeRecebida).not.toHaveBeenCalled();
  });

  it('valor diferente da mensalidade não casa', async () => {
    const { svc, erpLocacao } = build([contrato()], [cobranca({ valor: 250 })]);

    await svc.varrer('emp-1');

    expect(erpLocacao.mensalidadeRecebida).not.toHaveBeenCalled();
  });

  it('mês que não está esperando mensalidade é ignorado', async () => {
    // A linha de 09/2026 já foi recebida; a cobrança repetida não pode liberar
    // nada de novo.
    const { svc, erpLocacao } = build([
      contrato({ comissoes: [{ competencia: new Date(Date.UTC(2026, 9, 1)) }] }),
    ]);

    await svc.varrer('emp-1');

    expect(erpLocacao.mensalidadeRecebida).not.toHaveBeenCalled();
  });

  it('dois contratos do mesmo cliente, mesmo mês e valor: NÃO escolhe, avisa', async () => {
    // Chutar aqui é pagar comissão sobre dinheiro que não entrou naquele contrato.
    const { svc, erpLocacao } = build([contrato(), contrato({ id: 'ctr-2' })]);

    const r = await svc.varrer('emp-1');

    expect(erpLocacao.mensalidadeRecebida).not.toHaveBeenCalled();
    expect(r.avisos.some((a) => a.includes('casa com 2 contratos'))).toBe(true);
  });

  it('sem contrato esperando mensalidade, não chama o ERP', async () => {
    const { svc, contas } = build([]);

    const r = await svc.varrer('emp-1');

    expect(contas.listarContasReceber).not.toHaveBeenCalled();
    expect(r.mensalidadesRegistradas).toBe(0);
  });

  it('falha numa cobrança não derruba as outras', async () => {
    const { svc, erpLocacao } = build(
      [
        contrato({
          comissoes: [
            { competencia: COMPETENCIA },
            { competencia: new Date(Date.UTC(2026, 9, 1)) },
          ],
        }),
      ],
      [
        cobranca(),
        cobranca({
          id: 338303333,
          historico: 'Referente à cobrança de contrato 10/2026 e RPS nº 000000002',
        }),
      ],
    );
    erpLocacao.mensalidadeRecebida.mockRejectedValueOnce(new Error('ERP fora'));

    const r = await svc.varrer('emp-1');

    expect(r.avisos.some((a) => a.includes('ERP fora'))).toBe(true);
    expect(r.mensalidadesRegistradas).toBe(1);
  });
});
