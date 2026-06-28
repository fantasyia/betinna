import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { EvolutionInstanciasSyncJob } from './evolution-instancias-sync.job';

function setup(opts: { provider?: string; lock?: boolean } = {}) {
  const evolution = { listarInstanciasDetalhadas: vi.fn().mockResolvedValue([]) };
  const instancias = { sincronizarConexao: vi.fn().mockResolvedValue(undefined) };
  const env = {
    get: vi.fn((k: string) =>
      k === 'WHATSAPP_PROVIDER' ? (opts.provider ?? 'evolution') : 'production',
    ),
  };
  const cronLock = { acquire: vi.fn().mockResolvedValue(opts.lock ?? true) };
  const job = new EvolutionInstanciasSyncJob(
    evolution as never,
    instancias as never,
    env as never,
    cronLock as never,
  );
  return { job, evolution, instancias, cronLock };
}

describe('EvolutionInstanciasSyncJob', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('NÃO roda quando WHATSAPP_PROVIDER != evolution', async () => {
    const { job, evolution } = setup({ provider: 'baileys' });
    await job.sincronizar();
    expect(evolution.listarInstanciasDetalhadas).not.toHaveBeenCalled();
  });

  it('NÃO roda quando o lock não é adquirido (outra réplica já sincroniza)', async () => {
    const { job, evolution } = setup({ lock: false });
    await job.sincronizar();
    expect(evolution.listarInstanciasDetalhadas).not.toHaveBeenCalled();
  });

  it('sincroniza cada instância com nome/status/ownerJid', async () => {
    const { job, evolution, instancias } = setup();
    evolution.listarInstanciasDetalhadas.mockResolvedValue([
      { name: 'emp_emp-1', connectionStatus: 'open', ownerJid: '5511@s.whatsapp.net' },
      { name: 'user_rep-1', connectionStatus: 'connecting', ownerJid: null },
    ]);
    await job.sincronizar();
    expect(instancias.sincronizarConexao).toHaveBeenCalledTimes(2);
    expect(instancias.sincronizarConexao).toHaveBeenNthCalledWith(
      1,
      'emp_emp-1',
      'open',
      '5511@s.whatsapp.net',
    );
    expect(instancias.sincronizarConexao).toHaveBeenNthCalledWith(
      2,
      'user_rep-1',
      'connecting',
      null,
    );
  });

  it('status ausente vira "close"', async () => {
    const { job, evolution, instancias } = setup();
    evolution.listarInstanciasDetalhadas.mockResolvedValue([{ name: 'emp_emp-2' }]);
    await job.sincronizar();
    expect(instancias.sincronizarConexao).toHaveBeenCalledWith('emp_emp-2', 'close', undefined);
  });

  it('loga zumbi (open + disconnectionReasonCode)', async () => {
    const { job, evolution } = setup();
    evolution.listarInstanciasDetalhadas.mockResolvedValue([
      { name: 'emp_z', connectionStatus: 'open', disconnectionReasonCode: 401 },
    ]);
    await job.sincronizar();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ZUMBI'));
  });

  it('erro no Evolution NÃO lança (best-effort)', async () => {
    const { job, evolution } = setup();
    evolution.listarInstanciasDetalhadas.mockRejectedValue(new Error('evolution down'));
    await expect(job.sincronizar()).resolves.toBeUndefined();
  });
});
