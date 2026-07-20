import { describe, expect, it, vi } from 'vitest';
import { registrarTransicaoEtapa } from './lead-etapa-historico.util';

const fakeLogger = () => ({ error: vi.fn(), warn: vi.fn(), log: vi.fn() });

describe('registrarTransicaoEtapa', () => {
  it('grava a transição com os campos certos', async () => {
    const prisma = { leadEtapaHistorico: { create: vi.fn().mockResolvedValue({}) } };
    const logger = fakeLogger();
    await registrarTransicaoEtapa(prisma as never, logger as never, {
      empresaId: 'emp-1',
      leadId: 'l1',
      funilId: 'funil-1',
      etapaOrigem: 'et-a',
      etapaDestino: 'et-b',
      quem: 'user-1',
      origemMudanca: 'manual',
    });
    expect(prisma.leadEtapaHistorico.create).toHaveBeenCalledWith({
      data: {
        empresaId: 'emp-1',
        leadId: 'l1',
        funilId: 'funil-1',
        etapaOrigem: 'et-a',
        etapaDestino: 'et-b',
        quem: 'user-1',
        origemMudanca: 'manual',
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('null-safe: campos ausentes viram null; ocorridoEm omitido não vai no data', async () => {
    const prisma = { leadEtapaHistorico: { create: vi.fn().mockResolvedValue({}) } };
    await registrarTransicaoEtapa(prisma as never, fakeLogger() as never, {
      empresaId: 'emp-1',
      leadId: 'l1',
      origemMudanca: 'criacao',
    });
    const data = prisma.leadEtapaHistorico.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      funilId: null,
      etapaOrigem: null,
      etapaDestino: null,
      quem: null,
    });
    expect(data.ocorridoEm).toBeUndefined();
  });

  it('BEST-EFFORT: erro no create é engolido (loga ERROR, não propaga)', async () => {
    const prisma = {
      leadEtapaHistorico: { create: vi.fn().mockRejectedValue(new Error('db down')) },
    };
    const logger = fakeLogger();
    await expect(
      registrarTransicaoEtapa(prisma as never, logger as never, {
        empresaId: 'emp-1',
        leadId: 'l1',
        origemMudanca: 'fluxo',
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
